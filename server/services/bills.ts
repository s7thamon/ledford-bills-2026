import { and, asc, between, count, desc, eq, gt, inArray, isNull, like, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { todayIso, monthRange } from '../../shared/utils/dates'
import { splitAmounts } from '../../shared/utils/split'
import { allParticipantsPaid, canDeleteBill, canEditBill, canMarkCardPaid, canMarkParticipantPaid } from '../../shared/utils/rules'
import * as notify from './notify'

const { bills, billParticipants, refunds, users } = schema

export interface BillCredit {
  refundId: number
  amountCents: number
  shares: Record<number, number>
  sourceBillId: number
  sourceName: string
  sourceAddedOn: string
  refundedOn: string
}

export interface BillRefund {
  id: number
  amountCents: number
  refundedOn: string
  appliedToBillId: number | null
  appliedToName: string | null
  appliedToAddedOn: string | null
}

export interface BillDto {
  id: number
  name: string
  amountCents: number
  addedOn: string
  cardPaidAt: Date | null
  recurringBillId: number | null
  createdBy: number
  paidWithCardOf: number | null
  participants: { userId: number, amountCents: number, paidAt: Date | null }[]
  /** The refund credit this bill absorbed, if any (at most one). */
  credit: BillCredit | null
  /** Refunds recorded against this bill. */
  refunds: BillRefund[]
}

const withParticipants = {
  participants: { columns: { userId: true, amountCents: true, paidAt: true }, orderBy: asc(billParticipants.userId) },
  refunds: {
    columns: { id: true, amountCents: true, refundedOn: true, appliedToBillId: true },
    orderBy: asc(refunds.id),
    with: { appliedTo: { columns: { name: true, addedOn: true } } }
  },
  appliedCredits: {
    columns: { id: true, amountCents: true, refundedOn: true, billId: true },
    with: { shares: { columns: { userId: true, amountCents: true } }, bill: { columns: { name: true, addedOn: true } } }
  }
} as const
const billColumns = { id: true, name: true, amountCents: true, addedOn: true, cardPaidAt: true, recurringBillId: true, createdBy: true, paidWithCardOf: true } as const

type BillRow = NonNullable<Awaited<ReturnType<typeof findBill>>>

function findBill(id: number) {
  return useDb().query.bills.findFirst({ where: eq(bills.id, id), columns: billColumns, with: withParticipants })
}

function toDto({ refunds: refundRows, appliedCredits, ...bill }: BillRow): BillDto {
  const applied = appliedCredits[0]
  return {
    ...bill,
    credit: applied
      ? {
          refundId: applied.id,
          amountCents: applied.amountCents,
          shares: Object.fromEntries(applied.shares.map(s => [s.userId, s.amountCents])),
          sourceBillId: applied.billId,
          sourceName: applied.bill.name,
          sourceAddedOn: applied.bill.addedOn,
          refundedOn: applied.refundedOn
        }
      : null,
    refunds: refundRows.map(r => ({
      id: r.id,
      amountCents: r.amountCents,
      refundedOn: r.refundedOn,
      appliedToBillId: r.appliedToBillId,
      appliedToName: r.appliedTo?.name ?? null,
      appliedToAddedOn: r.appliedTo?.addedOn ?? null
    }))
  }
}

export async function getBill(id: number): Promise<BillDto> {
  const bill = await findBill(id)
  if (!bill) throw createError({ statusCode: 404, statusMessage: 'Bill not found.' })
  return toDto(bill)
}

export async function listBills(opts: { month: string, userId: number, userUnpaid?: boolean, cardUnpaid?: boolean }): Promise<BillDto[]> {
  const [start, end] = monthRange(opts.month)
  const rows = await useDb().query.bills.findMany({
    where: and(between(bills.addedOn, start, end), opts.cardUnpaid ? isNull(bills.cardPaidAt) : undefined),
    columns: billColumns,
    with: withParticipants,
    orderBy: [desc(bills.addedOn), desc(bills.id)]
  })
  const list = rows.map(toDto)
  return opts.userUnpaid
    ? list.filter(b => b.participants.some(p => p.userId === opts.userId && !p.paidAt))
    : list
}

export async function searchBills(q: string): Promise<BillDto[]> {
  const term = q.trim()
  if (!term) return []
  const escaped = term.replace(/[\\%_]/g, c => `\\${c}`)
  const rows = await useDb().query.bills.findMany({
    where: like(bills.name, `%${escaped}%`),
    columns: billColumns,
    with: withParticipants,
    orderBy: [desc(bills.addedOn), desc(bills.id)],
    limit: 500
  })
  return rows.map(toDto)
}

/** Names used more than once, most common first. */
export async function billNameSuggestions(): Promise<string[]> {
  const n = count()
  const rows = await useDb()
    .select({ name: bills.name, n })
    .from(bills)
    .groupBy(bills.name)
    .having(gt(n, 1))
    .orderBy(desc(n), asc(bills.name))
  return rows.map(r => r.name)
}

async function householdIds(): Promise<number[]> {
  const rows = await useDb().select({ id: users.id }).from(users).orderBy(asc(users.id))
  return rows.map(r => r.id)
}

function assertSplitsCover(splits: Record<number, number>, ids: number[], totalCents: number) {
  if (!ids.every(id => Number.isInteger(splits[id]) && splits[id]! >= 0)) {
    throw createError({ statusCode: 422, statusMessage: 'Every household member needs a split amount.' })
  }
  const sum = ids.reduce((acc, id) => acc + splits[id]!, 0)
  if (sum < totalCents) {
    throw createError({ statusCode: 422, statusMessage: 'Splits must add up to at least the bill amount.' })
  }
}

export async function createBill(input: {
  name: string
  amountCents: number
  createdBy: number
  addedOn?: string
  recurringBillId?: number | null
  splits?: Record<number, number>
}): Promise<BillDto> {
  const db = useDb()
  const ids = await householdIds()
  const amounts = input.splits ?? splitAmounts(input.amountCents, ids)
  if (input.splits) assertSplitsCover(input.splits, ids, input.amountCents)

  const billId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(bills).values({
      name: input.name.trim(),
      amountCents: input.amountCents,
      createdBy: input.createdBy,
      addedOn: input.addedOn ?? todayIso(),
      recurringBillId: input.recurringBillId ?? null
    })
    if (ids.length) {
      await tx.insert(billParticipants).values(ids.map(userId => ({ billId: res.insertId, userId, amountCents: amounts[userId] ?? 0 })))
    }
    return res.insertId
  })

  const bill = await getBill(billId)
  await notify.billAdded(bill, bill.participants)
  return bill
}

/** Changing only the amount resets to an equal split; passing splits sets them explicitly. */
export async function updateBill(id: number, input: { name?: string, amountCents?: number, splits?: Record<number, number> }): Promise<BillDto> {
  const bill = await getBill(id)
  if (!canEditBill(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'This bill already has payments, so it can no longer be edited.' })
  }
  const db = useDb()
  const total = input.amountCents ?? bill.amountCents
  const ids = await householdIds()
  let amounts: Record<number, number> | undefined
  if (input.splits) {
    assertSplitsCover(input.splits, ids, total)
    amounts = input.splits
  }
  else if (input.amountCents !== undefined && input.amountCents !== bill.amountCents) {
    amounts = splitAmounts(total, ids)
  }

  const amountsChange = total !== bill.amountCents
    || (!!amounts && bill.participants.some(p => amounts[p.userId] !== p.amountCents))
  await db.transaction(async (tx) => {
    // A credit was sized for the old amounts; send it back to unused rather than leave it stale.
    if (bill.credit && amountsChange) {
      await tx.update(refunds).set({ appliedToBillId: null, appliedAt: null }).where(eq(refunds.appliedToBillId, id))
    }
    const patch: Partial<typeof bills.$inferInsert> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.amountCents !== undefined) patch.amountCents = input.amountCents
    if (Object.keys(patch).length) await tx.update(bills).set(patch).where(eq(bills.id, id))
    if (amounts) {
      for (const userId of ids) {
        await tx.insert(billParticipants)
          .values({ billId: id, userId, amountCents: amounts[userId]! })
          .onDuplicateKeyUpdate({ set: { amountCents: amounts[userId]! } })
      }
    }
  })
  return getBill(id)
}

export async function deleteBill(id: number): Promise<BillDto> {
  const bill = await getBill(id)
  if (!canDeleteBill(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'Bills with payments cannot be deleted.' })
  }
  await useDb().delete(bills).where(eq(bills.id, id))
  return bill
}

export async function notifyIfCardReady(billId: number) {
  const bill = await getBill(billId)
  if (canMarkCardPaid(bill)) await notify.cardReady(bill)
}

/** Returns false when the share was already paid (nothing changed). */
export async function markParticipantPaid(billId: number, targetUserId: number, actorId: number, adminMode: boolean): Promise<boolean> {
  if (!canMarkParticipantPaid(actorId, targetUserId, adminMode)) {
    throw createError({ statusCode: 403, statusMessage: 'Turn on admin mode to mark someone else as paid.' })
  }
  const bill = await getBill(billId)
  const participant = bill.participants.find(p => p.userId === targetUserId)
  if (!participant) throw createError({ statusCode: 404, statusMessage: 'That person is not on this bill.' })
  if (participant.paidAt) return false

  await useDb().update(billParticipants)
    .set({ paidAt: new Date() })
    .where(and(eq(billParticipants.billId, billId), eq(billParticipants.userId, targetUserId), isNull(billParticipants.paidAt)))
  await notifyIfCardReady(billId)
  return true
}

export async function markCardPaid(billId: number): Promise<BillDto> {
  const bill = await getBill(billId)
  if (!canMarkCardPaid(bill)) {
    throw createError({ statusCode: 409, statusMessage: allParticipantsPaid(bill) ? 'The card is already paid.' : 'Everyone has to pay before the card can be paid.' })
  }
  await useDb().update(bills).set({ cardPaidAt: new Date() }).where(eq(bills.id, billId))
  return bill
}

/** Bulk pay: my unpaid shares, or the card on bills everyone has paid. Returns how many changed. */
export async function paySelected(ids: number[], actorId: number, target: 'me' | 'card'): Promise<number> {
  if (!ids.length) return 0
  const db = useDb()
  const selected = await db.query.bills.findMany({ where: inArray(bills.id, ids), columns: billColumns, with: withParticipants })

  if (target === 'me') {
    const billIds = selected.filter(b => b.participants.some(p => p.userId === actorId && !p.paidAt)).map(b => b.id)
    if (!billIds.length) return 0
    await db.update(billParticipants)
      .set({ paidAt: new Date() })
      .where(and(inArray(billParticipants.billId, billIds), eq(billParticipants.userId, actorId), isNull(billParticipants.paidAt)))
    for (const id of billIds) await notifyIfCardReady(id)
    return billIds.length
  }

  const billIds = selected.filter(canMarkCardPaid).map(b => b.id)
  if (billIds.length) await db.update(bills).set({ cardPaidAt: new Date() }).where(inArray(bills.id, billIds))
  return billIds.length
}

/** Bills in a month that still have an unpaid share or an unpaid card. */
export async function countUnpaidInMonth(month: string): Promise<number> {
  const [start, end] = monthRange(month)
  const [row] = await useDb()
    .select({ n: count() })
    .from(bills)
    .where(and(
      between(bills.addedOn, start, end),
      sql`(${bills.cardPaidAt} is null or exists (select 1 from bill_participants bp where bp.bill_id = ${bills.id} and bp.paid_at is null))`
    ))
  return row?.n ?? 0
}

/** Mark the purchase as made on someone's personal card (or clear it with null). */
export async function setPaidWithCard(billId: number, userId: number | null): Promise<BillDto> {
  await getBill(billId)
  if (userId !== null && !(await householdIds()).includes(userId)) {
    throw createError({ statusCode: 422, statusMessage: 'Pick someone in the household.' })
  }
  await useDb().update(bills).set({ paidWithCardOf: userId }).where(eq(bills.id, billId))
  return getBill(billId)
}
