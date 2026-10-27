import { and, asc, count, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { canEditReimbursement, canMarkReimbursementComplete, canMarkTransferComplete, reimbursementStatus } from '../../shared/utils/rules'
import * as notify from './notify'
import { otherUserId } from './users'

const { reimbursements } = schema

export type ReimbursementSort = 'createdAt' | 'name' | 'owedCents' | 'status'
export const PAGE_SIZE = 10

export async function getReimbursement(id: number) {
  const row = await useDb().query.reimbursements.findFirst({ where: eq(reimbursements.id, id) })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Reimbursement not found.' })
  return row
}

export async function listReimbursements(opts: { resolved: boolean, page: number, sort: ReimbursementSort, dir: 'asc' | 'desc', q?: string }) {
  const db = useDb()
  const digits = opts.q?.replace(/[$,\s]/g, '')
  // Matches the name, or the amount as typed ("26.8" finds $26.80).
  const search = opts.q
    ? or(like(reimbursements.name, `%${opts.q}%`), digits ? like(sql`cast(${reimbursements.owedCents} / 100 as decimal(12,2))`, `%${digits}%`) : undefined)
    : undefined
  const where = and(opts.resolved ? undefined : isNull(reimbursements.completedAt), search)
  const order = opts.dir === 'asc' ? asc : desc
  const statusRank = sql`case when ${reimbursements.completedAt} is not null then 2 when ${reimbursements.transferCompletedAt} is not null then 1 else 0 end`
  const primary: SQL = opts.sort === 'name'
    ? order(reimbursements.name)
    : opts.sort === 'owedCents'
      ? order(reimbursements.owedCents)
      : opts.sort === 'status'
        ? sql`${statusRank} ${sql.raw(opts.dir)}`
        : order(reimbursements.createdAt)

  const [items, [totals], open] = await Promise.all([
    db.select().from(reimbursements).where(where)
      .orderBy(primary, desc(reimbursements.createdAt), desc(reimbursements.id))
      .limit(PAGE_SIZE).offset((opts.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(reimbursements).where(where),
    // Everything still open across every page, keyed by who is owed.
    db.select({ createdBy: reimbursements.createdBy, cents: sql<string>`sum(${reimbursements.owedCents})` })
      .from(reimbursements).where(isNull(reimbursements.completedAt)).groupBy(reimbursements.createdBy)
  ])
  const openOwedTo = Object.fromEntries(open.map(r => [r.createdBy, Number(r.cents)])) as Record<number, number>
  return { items, total: totals?.n ?? 0, pageSize: PAGE_SIZE, openOwedTo }
}

/** Open items waiting on this person: money to send, or a transfer to confirm. */
export async function countWaitingOn(userId: number) {
  const [row] = await useDb().select({ n: count() }).from(reimbursements).where(and(
    isNull(reimbursements.completedAt),
    or(
      and(eq(reimbursements.otherUserId, userId), isNull(reimbursements.transferCompletedAt)),
      and(eq(reimbursements.createdBy, userId), sql`${reimbursements.transferCompletedAt} is not null`)
    )
  ))
  return row?.n ?? 0
}

export async function createReimbursement(input: {
  name: string
  owedCents: number
  createdBy: number
  notes?: string | null
  otherUserId?: number
  recurringBillId?: number | null
}) {
  const other = input.otherUserId ?? await otherUserId(input.createdBy)
  if (!other) throw createError({ statusCode: 422, statusMessage: 'No other user found to assign this reimbursement.' })
  const [res] = await useDb().insert(reimbursements).values({
    name: input.name.trim(),
    owedCents: input.owedCents,
    createdBy: input.createdBy,
    otherUserId: other,
    notes: input.notes?.trim() || null,
    recurringBillId: input.recurringBillId ?? null
  })
  const row = await getReimbursement(res.insertId)
  await notify.reimbursementCreated(row)
  return row
}

export async function updateReimbursement(id: number, userId: number, input: { name: string, owedCents: number, notes?: string | null }) {
  const row = await getReimbursement(id)
  if (!canEditReimbursement(row, userId)) {
    throw createError({ statusCode: 403, statusMessage: 'Only the person owed can edit this, and only before payment is sent.' })
  }
  await useDb().update(reimbursements)
    .set({ name: input.name.trim(), owedCents: input.owedCents, notes: input.notes?.trim() || null })
    .where(eq(reimbursements.id, id))
  return getReimbursement(id)
}

export async function deleteReimbursement(id: number, userId: number) {
  const row = await getReimbursement(id)
  if (!canEditReimbursement(row, userId)) {
    throw createError({ statusCode: 403, statusMessage: 'Only the person owed can delete this, and only before payment is sent.' })
  }
  await useDb().delete(reimbursements).where(eq(reimbursements.id, id))
  return row
}

/** The person who owes marks it sent. Admin mode can do it for them. */
export async function markTransferComplete(id: number, userId: number, adminMode = false) {
  const row = await getReimbursement(id)
  const allowed = canMarkTransferComplete(row, userId) || (adminMode && reimbursementStatus(row) === 'awaiting')
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Only the person who owes can mark this as sent.' })
  await useDb().update(reimbursements).set({ transferCompletedAt: new Date() }).where(and(eq(reimbursements.id, id), isNull(reimbursements.transferCompletedAt)))
  await notify.transferCompleted(row)
  return row
}

/** The person owed confirms receipt. Admin mode can do it for them. */
export async function markReimbursementComplete(id: number, userId: number, adminMode = false) {
  const row = await getReimbursement(id)
  const allowed = canMarkReimbursementComplete(row, userId) || (adminMode && reimbursementStatus(row) === 'sent')
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Only the person owed can confirm receipt, after payment is sent.' })
  await useDb().update(reimbursements).set({ completedAt: new Date() }).where(eq(reimbursements.id, id))
  return row
}
