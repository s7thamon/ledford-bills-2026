import { and, asc, between, desc, eq, max, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { daysInMonth, monthRange, todayIso } from '../../shared/utils/dates'
import { splitAmounts } from '../../shared/utils/split'
import { createBill } from './bills'
import { createReimbursement } from './reimbursements'

const { recurringBills, recurringBillParticipants, bills, reimbursements, users } = schema

export type RecurringType = 'bill' | 'reimbursement'

export interface RecurringInput {
  type: RecurringType
  name: string
  amountCents: number
  dayOfMonth: number
  otherUserId?: number | null
  splits?: Record<number, number>
  active?: boolean
}

const order = [asc(recurringBills.dayOfMonth), desc(recurringBills.sortOrder), asc(recurringBills.name), asc(recurringBills.id)]

export async function listRecurring() {
  return useDb().query.recurringBills.findMany({
    orderBy: order,
    with: { participants: { columns: { userId: true, amountCents: true }, orderBy: asc(recurringBillParticipants.userId) } }
  })
}

export async function getRecurring(id: number) {
  const row = await useDb().query.recurringBills.findFirst({ where: eq(recurringBills.id, id), with: { participants: true } })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Recurring bill not found.' })
  return row
}

async function householdIds() {
  return (await useDb().select({ id: users.id }).from(users).orderBy(asc(users.id))).map(r => r.id)
}

async function nextSortOrder(day: number) {
  const [row] = await useDb().select({ top: max(recurringBills.sortOrder) }).from(recurringBills).where(eq(recurringBills.dayOfMonth, day))
  return row?.top == null ? 0 : row.top + 1
}

/** Re-number a day's templates so sort_order is dense: top of the list has the highest value. */
async function normalizeDay(day: number) {
  const db = useDb()
  const rows = await db.select({ id: recurringBills.id }).from(recurringBills).where(eq(recurringBills.dayOfMonth, day)).orderBy(desc(recurringBills.sortOrder), asc(recurringBills.name), asc(recurringBills.id))
  for (const [i, row] of rows.entries()) {
    await db.update(recurringBills).set({ sortOrder: rows.length - 1 - i }).where(eq(recurringBills.id, row.id))
  }
}

async function resolveSplits(input: RecurringInput, ids: number[]) {
  if (!input.splits) return splitAmounts(input.amountCents, ids)
  const sum = ids.reduce((acc, id) => acc + (input.splits![id] ?? 0), 0)
  if (sum < input.amountCents) throw createError({ statusCode: 422, statusMessage: 'Splits must add up to at least the amount.' })
  return input.splits
}

function assertReimbursementTarget(input: RecurringInput) {
  if (input.type === 'reimbursement' && !input.otherUserId) {
    throw createError({ statusCode: 422, statusMessage: 'Choose who owes this reimbursement.' })
  }
}

export async function createRecurring(input: RecurringInput, createdBy: number) {
  assertReimbursementTarget(input)
  const db = useDb()
  const ids = await householdIds()
  const splits = input.type === 'bill' ? await resolveSplits(input, ids) : null
  const sortOrder = await nextSortOrder(input.dayOfMonth)
  const id = await db.transaction(async (tx) => {
    const [res] = await tx.insert(recurringBills).values({
      createdBy,
      type: input.type,
      otherUserId: input.type === 'reimbursement' ? input.otherUserId! : null,
      name: input.name.trim(),
      amountCents: input.amountCents,
      dayOfMonth: input.dayOfMonth,
      sortOrder,
      active: input.active ?? true
    })
    if (splits) {
      await tx.insert(recurringBillParticipants).values(ids.map(userId => ({ recurringBillId: res.insertId, userId, amountCents: splits[userId] ?? 0 })))
    }
    return res.insertId
  })
  return getRecurring(id)
}

export async function updateRecurring(id: number, input: RecurringInput) {
  assertReimbursementTarget(input)
  const existing = await getRecurring(id)
  const db = useDb()
  const ids = await householdIds()
  const dayChanged = existing.dayOfMonth !== input.dayOfMonth
  const keepSplits = input.type === 'bill' && !input.splits && existing.type === 'bill' && existing.amountCents === input.amountCents && existing.participants.length > 0
  const splits = input.type === 'bill' && !keepSplits ? await resolveSplits(input, ids) : null
  const sortOrder = dayChanged ? await nextSortOrder(input.dayOfMonth) : existing.sortOrder

  await db.transaction(async (tx) => {
    await tx.update(recurringBills).set({
      type: input.type,
      otherUserId: input.type === 'reimbursement' ? input.otherUserId! : null,
      name: input.name.trim(),
      amountCents: input.amountCents,
      dayOfMonth: input.dayOfMonth,
      sortOrder,
      ...(input.active === undefined ? {} : { active: input.active })
    }).where(eq(recurringBills.id, id))

    if (input.type === 'reimbursement') {
      await tx.delete(recurringBillParticipants).where(eq(recurringBillParticipants.recurringBillId, id))
    }
    else if (splits) {
      for (const userId of ids) {
        await tx.insert(recurringBillParticipants)
          .values({ recurringBillId: id, userId, amountCents: splits[userId] ?? 0 })
          .onDuplicateKeyUpdate({ set: { amountCents: splits[userId] ?? 0 } })
      }
    }
  })
  if (dayChanged) await normalizeDay(existing.dayOfMonth)
  return getRecurring(id)
}

export async function setRecurringActive(id: number, active: boolean) {
  await getRecurring(id)
  await useDb().update(recurringBills).set({ active }).where(eq(recurringBills.id, id))
  return getRecurring(id)
}

export async function deleteRecurring(id: number) {
  const existing = await getRecurring(id)
  await useDb().delete(recurringBills).where(eq(recurringBills.id, id))
  await normalizeDay(existing.dayOfMonth)
  return existing
}

/** Move a template up (-1) or down (+1) among templates on the same day. */
export async function moveRecurring(id: number, direction: -1 | 1) {
  const existing = await getRecurring(id)
  await normalizeDay(existing.dayOfMonth)
  const db = useDb()
  const sameDay = await db.select({ id: recurringBills.id, sortOrder: recurringBills.sortOrder }).from(recurringBills)
    .where(eq(recurringBills.dayOfMonth, existing.dayOfMonth))
    .orderBy(desc(recurringBills.sortOrder), asc(recurringBills.name), asc(recurringBills.id))
  const index = sameDay.findIndex(r => r.id === id)
  const target = sameDay[index + direction]
  if (index < 0 || !target) return
  await db.transaction(async (tx) => {
    await tx.update(recurringBills).set({ sortOrder: target.sortOrder }).where(eq(recurringBills.id, id))
    await tx.update(recurringBills).set({ sortOrder: sameDay[index]!.sortOrder }).where(eq(recurringBills.id, target.id))
  })
}

/**
 * Create this month's bills/reimbursements for active templates scheduled today.
 * Days past the end of the month run on the last day. Safe to run more than once a day.
 */
export async function generateRecurring(today = todayIso()): Promise<number> {
  const db = useDb()
  const month = today.slice(0, 7)
  const [start, end] = monthRange(month)
  const day = Number(today.slice(8, 10))
  const lastDay = daysInMonth(month)
  const ids = await householdIds()
  let created = 0

  const templates = await db.query.recurringBills.findMany({ where: eq(recurringBills.active, true), orderBy: order, with: { participants: true } })

  for (const t of templates) {
    if (Math.min(t.dayOfMonth, lastDay) !== day) continue

    if (t.type === 'reimbursement') {
      if (!t.otherUserId) continue
      const owedTo = ids.find(id => id !== t.otherUserId)
      if (!owedTo) continue
      const exists = await db.query.reimbursements.findFirst({
        where: and(eq(reimbursements.recurringBillId, t.id), sql`date(${reimbursements.createdAt}) between ${start} and ${end}`),
        columns: { id: true }
      })
      if (exists) continue
      await createReimbursement({ name: t.name, owedCents: t.amountCents, createdBy: owedTo, otherUserId: t.otherUserId, recurringBillId: t.id })
      created++
      continue
    }

    const exists = await db.query.bills.findFirst({
      where: and(eq(bills.recurringBillId, t.id), between(bills.addedOn, start, end)),
      columns: { id: true }
    })
    if (exists) continue

    const templateSplits = Object.fromEntries(t.participants.map(p => [p.userId, p.amountCents]))
    const covers = ids.every(id => id in templateSplits) && ids.reduce((s, id) => s + templateSplits[id]!, 0) >= t.amountCents
    await createBill({
      name: t.name,
      amountCents: t.amountCents,
      createdBy: t.createdBy,
      addedOn: today,
      recurringBillId: t.id,
      splits: covers ? templateSplits : undefined
    })
    created++
  }
  return created
}
