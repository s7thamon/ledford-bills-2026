import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { creditFromPieces, poolsFromRefunds, shareDue, sizeBite, splitRefund } from '../../shared/utils/credits'
import { canEditBill, canRemoveCredit, canTakeCredit, isDirectPayName, onSharedCard } from '../../shared/utils/rules'
import { getBill, notifyIfCardReady, releaseCredit, type BillDto } from './bills'
import { getDirectPayNames } from './settings'

const { refunds, refundShares, creditUses, billParticipants } = schema

export interface RefundUse {
  billId: number
  billName: string
  billAddedOn: string
  amountCents: number
  shares: Record<number, number>
  /** The bill's whole credit can still come back off it. */
  removable: boolean
}

export interface RefundDto {
  id: number
  billId: number
  billName: string
  billAddedOn: string
  amountCents: number
  refundedOn: string
  shares: Record<number, number>
  /** Credit not used yet, per person; the card's is their sum. */
  left: Record<number, number>
  leftCents: number
  /** Bills that took a bite, oldest first. */
  uses: RefundUse[]
}

const refundQuery = {
  columns: { id: true, billId: true, amountCents: true, refundedOn: true },
  with: {
    bill: { columns: { name: true, addedOn: true } },
    shares: { columns: { userId: true, amountCents: true } },
    uses: { columns: { billId: true, userId: true, amountCents: true }, orderBy: asc(creditUses.id), with: { bill: { columns: { name: true, addedOn: true } } } }
  }
} as const

type RefundRow = NonNullable<Awaited<ReturnType<typeof findRefund>>>

function findRefund(id: number) {
  return useDb().query.refunds.findFirst({ where: eq(refunds.id, id), ...refundQuery })
}

async function toDtos(rows: RefundRow[]): Promise<RefundDto[]> {
  const usedBillIds = [...new Set(rows.flatMap(r => r.uses.map(u => u.billId)))]
  const removable = new Map<number, boolean>()
  for (const id of usedBillIds) removable.set(id, canRemoveCredit(await getBill(id)))
  return rows.map(({ bill, shares, uses: pieces, ...r }) => {
    const left = Object.fromEntries(shares.map(s => [s.userId, s.amountCents - pieces.filter(x => x.userId === s.userId).reduce((sum, x) => sum + x.amountCents, 0)]))
    const uses = new Map<number, RefundUse>()
    for (const x of pieces) {
      const use = uses.get(x.billId) ?? { billId: x.billId, billName: x.bill.name, billAddedOn: x.bill.addedOn, amountCents: 0, shares: {}, removable: removable.get(x.billId)! }
      use.amountCents += x.amountCents
      use.shares[x.userId] = (use.shares[x.userId] ?? 0) + x.amountCents
      uses.set(x.billId, use)
    }
    return {
      ...r,
      billName: bill.name,
      billAddedOn: bill.addedOn,
      shares: Object.fromEntries(shares.map(s => [s.userId, s.amountCents])),
      left,
      leftCents: Object.values(left).reduce((sum, c) => sum + c, 0),
      uses: [...uses.values()]
    }
  })
}

export async function getRefund(id: number): Promise<RefundDto> {
  const row = await findRefund(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Refund not found.' })
  return (await toDtos([row]))[0]!
}

export async function listRefunds(): Promise<RefundDto[]> {
  const rows = await useDb().query.refunds.findMany({ ...refundQuery, orderBy: [desc(refunds.refundedOn), desc(refunds.id)] })
  return toDtos(rows)
}

/** Record money a store put back on the card. Only for bills that already have payments. */
export async function recordRefund(billId: number, input: { amountCents: number, refundedOn: string }, actorId: number): Promise<RefundDto> {
  const bill = await getBill(billId)
  if (canEditBill(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'Nobody has paid this bill yet. Change its amount instead.' })
  }
  if (!onSharedCard(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'This bill was paid by check, so the refund did not go to the shared card.' })
  }
  if (isDirectPayName(bill.name, await getDirectPayNames())) {
    throw createError({ statusCode: 409, statusMessage: 'This bill is paid directly from the shared account, so the refund did not go to the Citi card.' })
  }
  const remaining = bill.amountCents - bill.refunds.reduce((sum, r) => sum + r.amountCents, 0)
  if (input.amountCents < 1 || input.amountCents > remaining) {
    throw createError({ statusCode: 422, statusMessage: `The refund can be at most ${(remaining / 100).toFixed(2)}.` })
  }
  const shares = splitRefund(input.amountCents, bill.participants)
  const id = await useDb().transaction(async (tx) => {
    const [res] = await tx.insert(refunds).values({ billId, amountCents: input.amountCents, refundedOn: input.refundedOn, createdBy: actorId })
    await tx.insert(refundShares).values(Object.entries(shares).map(([userId, amountCents]) => ({ refundId: res.insertId, userId: Number(userId), amountCents })))
    return res.insertId
  })
  return getRefund(id)
}

/** Let an unpaid shared-card bill use as much of the running credit as it can. Shares the credit fully covers are marked paid. */
export async function applyCredit(billId: number): Promise<BillDto> {
  const bill = await getBill(billId)
  if (!canTakeCredit(bill, isDirectPayName(bill.name, await getDirectPayNames()))) {
    throw createError({ statusCode: 409, statusMessage: 'Credit can only go on an unpaid bill that goes on the Citi card and has no credit yet.' })
  }
  const covered = await useDb().transaction(async (tx) => {
    // Lock every refund so two bills applying at once cannot both spend the same credit.
    await tx.select({ id: refunds.id }).from(refunds).for('update')
    const [existing] = await tx.select({ n: sql<number>`count(*)` }).from(creditUses).where(eq(creditUses.billId, billId))
    if (Number(existing?.n)) throw createError({ statusCode: 409, statusMessage: 'This bill already has a credit.' })
    const shares = await tx.select({ refundId: refundShares.refundId, userId: refundShares.userId, amountCents: refundShares.amountCents, billId: refunds.billId, refundedOn: refunds.refundedOn })
      .from(refundShares).innerJoin(refunds, eq(refunds.id, refundShares.refundId))
    const used = await tx.select({ refundId: creditUses.refundId, userId: creditUses.userId, amountCents: creditUses.amountCents }).from(creditUses)
    const byRefund = new Map<number, { id: number, billId: number, refundedOn: string, left: Record<number, number>, leftCents: number }>()
    for (const s of shares) {
      const r = byRefund.get(s.refundId) ?? { id: s.refundId, billId: s.billId, refundedOn: s.refundedOn, left: {}, leftCents: 0 }
      const spent = used.filter(u => u.refundId === s.refundId && u.userId === s.userId).reduce((sum, u) => sum + u.amountCents, 0)
      r.left[s.userId] = s.amountCents - spent
      r.leftCents += s.amountCents - spent
      byRefund.set(s.refundId, r)
    }
    const pieces = sizeBite(bill, poolsFromRefunds([...byRefund.values()]))
    if (!pieces.length) throw createError({ statusCode: 409, statusMessage: 'No refund credit is left.' })
    await tx.insert(creditUses).values(pieces.map(x => ({ ...x, billId })))
    const credit = creditFromPieces(pieces)
    const covered = bill.participants.filter(p => shareDue(p, credit) === 0).map(p => p.userId)
    if (covered.length) {
      await tx.update(billParticipants)
        .set({ paidAt: new Date() })
        .where(and(eq(billParticipants.billId, billId), inArray(billParticipants.userId, covered), isNull(billParticipants.paidAt)))
    }
    return covered
  })
  if (covered.length) await notifyIfCardReady(billId)
  return getBill(billId)
}

/** Put a bill's credit back to unused. Allowed until someone pays real money on it, and never once it was refunded. */
export async function removeCredit(billId: number): Promise<void> {
  const bill = await getBill(billId)
  if (!bill.credit) return
  if (!canRemoveCredit(bill)) {
    throw createError({ statusCode: 409, statusMessage: bill.refunds.length
      ? 'This bill was refunded, so the credit it used stays on it.'
      : 'Someone already paid that bill, so the credit can no longer be moved.' })
  }
  await useDb().transaction(tx => releaseCredit(tx, bill))
}

export async function deleteRefund(refundId: number): Promise<void> {
  const refund = await getRefund(refundId)
  if (refund.uses.length) throw createError({ statusCode: 409, statusMessage: 'Remove the credit from the bills that used it before deleting the refund.' })
  await useDb().delete(refunds).where(eq(refunds.id, refundId))
}
