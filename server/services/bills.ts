import { and, asc, between, count, desc, eq, gt, inArray, isNull, like, notInArray, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb, type Db } from '../db/client'
import { todayIso, monthRange } from '../../shared/utils/dates'
import { splitAmounts } from '../../shared/utils/split'
import { allParticipantsPaid, canDeleteBill, canEditAmounts, canMarkCardPaid, canMarkParticipantPaid, canRemoveCredit, isDirectPayName } from '../../shared/utils/rules'
import { cardDue, creditFromPieces, shareDue, type CreditLike } from '../../shared/utils/credits'
import type { ReconcileBill, ReconcileRefund } from '../../shared/utils/reconcile'
import { searchKey, type InsightBill } from '../../shared/utils/insights'
import * as notify from './notify'
import { getDirectPayNames } from './settings'

const { bills, billParticipants, creditUses, refunds, users } = schema

/** One refund a bill's credit came from, and the pieces it took. */
export interface CreditSource {
  refundId: number
  sourceBillId: number
  sourceName: string
  sourceAddedOn: string
  refundedOn: string
  amountCents: number
  shares: Record<number, number>
}

/** The refund credit a bill used: totals, plus where each piece came from. */
export type BillCredit = CreditLike & { sources: CreditSource[] }

export interface BillRefund {
  id: number
  amountCents: number
  refundedOn: string
  /** Bills that used this refund's credit, oldest first. */
  uses: { billName: string, billAddedOn: string, amountCents: number }[]
}

export interface BillDto {
  id: number
  name: string
  amountCents: number
  addedOn: string
  cardPaidAt: Date | null
  recurringBillId: number | null
  createdBy: number
  paidByCheck: boolean
  participants: { userId: number, amountCents: number, paidAt: Date | null }[]
  /** The refund credit this bill used, if any. */
  credit: BillCredit | null
  /** Refunds recorded against this bill. */
  refunds: BillRefund[]
}

const withParticipants = {
  participants: { columns: { userId: true, amountCents: true, paidAt: true }, orderBy: asc(billParticipants.userId) },
  refunds: {
    columns: { id: true, amountCents: true, refundedOn: true },
    orderBy: asc(refunds.id),
    with: { uses: { columns: { billId: true, amountCents: true }, orderBy: asc(creditUses.id), with: { bill: { columns: { name: true, addedOn: true } } } } }
  },
  creditUses: {
    columns: { refundId: true, userId: true, amountCents: true },
    orderBy: asc(creditUses.id),
    with: { refund: { columns: { billId: true, refundedOn: true }, with: { bill: { columns: { name: true, addedOn: true } } } } }
  }
} as const
const billColumns = { id: true, name: true, amountCents: true, addedOn: true, cardPaidAt: true, recurringBillId: true, createdBy: true, paidByCheck: true } as const

type BillRow = NonNullable<Awaited<ReturnType<typeof findBill>>>

function findBill(id: number) {
  return useDb().query.bills.findFirst({ where: eq(bills.id, id), columns: billColumns, with: withParticipants })
}

function toDto({ refunds: refundRows, creditUses: pieces, ...bill }: BillRow): BillDto {
  const sources = new Map<number, CreditSource>()
  for (const x of pieces) {
    const src = sources.get(x.refundId) ?? { refundId: x.refundId, sourceBillId: x.refund.billId, sourceName: x.refund.bill.name, sourceAddedOn: x.refund.bill.addedOn, refundedOn: x.refund.refundedOn, amountCents: 0, shares: {} }
    src.amountCents += x.amountCents
    src.shares[x.userId] = (src.shares[x.userId] ?? 0) + x.amountCents
    sources.set(x.refundId, src)
  }
  return {
    ...bill,
    credit: pieces.length ? { ...creditFromPieces(pieces), sources: [...sources.values()].sort((a, b) => a.refundedOn.localeCompare(b.refundedOn) || a.refundId - b.refundId) } : null,
    refunds: refundRows.map(r => ({
      id: r.id,
      amountCents: r.amountCents,
      refundedOn: r.refundedOn,
      uses: [...r.uses.reduce((byBill, u) => {
        const use = byBill.get(u.billId) ?? { billName: u.bill.name, billAddedOn: u.bill.addedOn, amountCents: 0 }
        use.amountCents += u.amountCents
        return byBill.set(u.billId, use)
      }, new Map<number, BillRefund['uses'][number]>()).values()]
    }))
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Send a bill's credit back to unused, unmarking shares that were only "paid" because the credit covered them. */
export async function releaseCredit(tx: Tx, bill: BillDto) {
  if (!bill.credit) return
  const covered = bill.participants.filter(p => p.paidAt && shareDue(p, bill.credit) === 0).map(p => p.userId)
  if (covered.length) {
    await tx.update(billParticipants).set({ paidAt: null }).where(and(eq(billParticipants.billId, bill.id), inArray(billParticipants.userId, covered)))
  }
  await tx.delete(creditUses).where(eq(creditUses.billId, bill.id))
}

export async function getBill(id: number): Promise<BillDto> {
  const bill = await findBill(id)
  if (!bill) throw createError({ statusCode: 404, statusMessage: 'Bill not found.' })
  return toDto(bill)
}

export async function listBills(opts: { month: string, userId: number, userUnpaid?: boolean, cardUnpaid?: boolean }): Promise<BillDto[]> {
  const [start, end] = monthRange(opts.month)
  const rows = await useDb().query.bills.findMany({
    where: and(between(bills.addedOn, start, end), opts.cardUnpaid ? and(isNull(bills.cardPaidAt), eq(bills.paidByCheck, false)) : undefined),
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
  const key = searchKey(term)
  const rows = await useDb().query.bills.findMany({
    // Also match with case, spaces and punctuation ignored, so "foodlion" finds "Food Lion".
    where: or(like(bills.name, `%${escaped}%`), key ? sql`regexp_replace(lower(${bills.name}), '[^a-z0-9]', '') like ${`%${key}%`}` : undefined),
    columns: billColumns,
    with: withParticipants,
    orderBy: [desc(bills.addedOn), desc(bills.id)],
    limit: 500
  })
  return rows.map(toDto)
}

/** Every bill added in a range of months, slim, for the Insights page. */
export async function billsForInsights(fromMonth: string, toMonth: string): Promise<InsightBill[]> {
  return useDb().select({ id: bills.id, name: bills.name, amountCents: bills.amountCents, addedOn: bills.addedOn })
    .from(bills)
    .where(between(bills.addedOn, monthRange(fromMonth)[0], monthRange(toMonth)[1]))
    .orderBy(asc(bills.addedOn), asc(bills.id))
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
  if (!canEditAmounts(bill)) {
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
    if (amountsChange) await releaseCredit(tx, bill)
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
  if (canMarkCardPaid(bill)) await notify.cardReady(bill, isDirectPayName(bill.name, await getDirectPayNames()))
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

/** Per month (YYYY-MM), bills that still have an unpaid share or an unpaid card. Months with none are left out. */
export async function unpaidByMonth(fromMonth: string, toMonth: string): Promise<Record<string, number>> {
  const month = sql<string>`date_format(${bills.addedOn}, '%Y-%m')`
  const rows = await useDb()
    .select({ month, n: count() })
    .from(bills)
    .where(and(
      between(bills.addedOn, monthRange(fromMonth)[0], monthRange(toMonth)[1]),
      sql`((${bills.cardPaidAt} is null and not ${bills.paidByCheck}) or exists (select 1 from bill_participants bp where bp.bill_id = ${bills.id} and bp.paid_at is null))`
    ))
    .groupBy(month)
  return Object.fromEntries(rows.map(r => [r.month, r.n]))
}

export const countUnpaidInMonth = async (month: string) => (await unpaidByMonth(month, month))[month] ?? 0

/** Paid by check from the shared account, or back on the shared card. Switching to check hands back an unused credit. */
export async function setPaidByCheck(billId: number, check: boolean): Promise<BillDto> {
  const bill = await getBill(billId)
  if (bill.cardPaidAt || bill.refunds.length) {
    throw createError({ statusCode: 409, statusMessage: 'This bill already has a card payment or refund, so how it was paid can no longer change.' })
  }
  if (bill.credit && !canRemoveCredit(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'Someone already paid this bill with the credit taken off. Delete it (admin) and add it again as a check.' })
  }
  await useDb().transaction(async (tx) => {
    if (check) await releaseCredit(tx, bill)
    await tx.update(bills).set({ paidByCheck: check }).where(eq(bills.id, billId))
  })
  return getBill(billId)
}

/** Shared-card bills and refunds a Citi statement covering from..to could mention (±5 days). */
export async function listForReconcile(from: string, to: string): Promise<{ bills: ReconcileBill[], refunds: ReconcileRefund[] }> {
  const start = shiftDate(from, -5)
  const end = shiftDate(to, 5)
  const directPay = await getDirectPayNames()
  const rows = await useDb().query.bills.findMany({
    where: and(
      eq(bills.paidByCheck, false),
      // MySQL compares names case-insensitively, so "ledford mortgage" still counts.
      directPay.length ? notInArray(bills.name, directPay) : undefined,
      or(between(bills.addedOn, start, end), between(bills.cardPaidAt, new Date(`${start}T00:00:00Z`), new Date(`${shiftDate(end, 1)}T23:59:59Z`)))
    ),
    columns: billColumns,
    with: withParticipants,
    orderBy: [asc(bills.addedOn), asc(bills.id)]
  })
  const refundRows = await useDb().select({ id: refunds.id, billId: refunds.billId, amountCents: refunds.amountCents, refundedOn: refunds.refundedOn })
    .from(refunds)
    // A refund on a check bill never went to Citi.
    .innerJoin(bills, eq(bills.id, refunds.billId))
    .where(and(between(refunds.refundedOn, start, end), eq(bills.paidByCheck, false)))
    .orderBy(asc(refunds.refundedOn), asc(refunds.id))
  return {
    bills: rows.map(toDto).map(b => ({
      id: b.id,
      name: b.name,
      amountCents: b.amountCents,
      addedOn: b.addedOn,
      cardPaidAt: b.cardPaidAt ? b.cardPaidAt.toISOString() : null,
      cardPaidOn: b.cardPaidAt ? todayIso(b.cardPaidAt) : null,
      cardDueCents: cardDue(b)
    })),
    refunds: refundRows
  }
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
