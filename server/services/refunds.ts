import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { canAbsorb, shareDue, splitRefund } from '../../shared/utils/credits'
import { canEditBill, onSharedCard } from '../../shared/utils/rules'
import { getBill, notifyIfCardReady, type BillDto } from './bills'

const { refunds, refundShares, billParticipants } = schema

export interface RefundDto {
  id: number
  billId: number
  billName: string
  billAddedOn: string
  amountCents: number
  refundedOn: string
  shares: Record<number, number>
  appliedToBillId: number | null
  appliedToName: string | null
  appliedToAddedOn: string | null
  appliedAt: Date | null
}

const refundQuery = {
  columns: { id: true, billId: true, amountCents: true, refundedOn: true, appliedToBillId: true, appliedAt: true },
  with: {
    bill: { columns: { name: true, addedOn: true } },
    appliedTo: { columns: { name: true, addedOn: true } },
    shares: { columns: { userId: true, amountCents: true } }
  }
} as const

type RefundRow = NonNullable<Awaited<ReturnType<typeof findRefund>>>

function findRefund(id: number) {
  return useDb().query.refunds.findFirst({ where: eq(refunds.id, id), ...refundQuery })
}

function toDto({ bill, appliedTo, shares, ...r }: RefundRow): RefundDto {
  return {
    ...r,
    billName: bill.name,
    billAddedOn: bill.addedOn,
    shares: Object.fromEntries(shares.map(s => [s.userId, s.amountCents])),
    appliedToName: appliedTo?.name ?? null,
    appliedToAddedOn: appliedTo?.addedOn ?? null
  }
}

export async function getRefund(id: number): Promise<RefundDto> {
  const row = await findRefund(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Refund not found.' })
  return toDto(row)
}

export async function listRefunds(): Promise<RefundDto[]> {
  const rows = await useDb().query.refunds.findMany({ ...refundQuery, orderBy: [desc(refunds.refundedOn), desc(refunds.id)] })
  return rows.map(toDto)
}

/** Record money a store put back on the card. Only for bills that already have payments. */
export async function recordRefund(billId: number, input: { amountCents: number, refundedOn: string }, actorId: number): Promise<RefundDto> {
  const bill = await getBill(billId)
  if (canEditBill(bill)) {
    throw createError({ statusCode: 409, statusMessage: 'Nobody has paid this bill yet. Change its amount instead.' })
  }
  if (!onSharedCard(bill)) {
    throw createError({ statusCode: 409, statusMessage: `This bill was paid ${bill.paidByCheck ? 'by check' : 'with a personal card'}, so the refund did not go to the shared card.` })
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

/** Let a new, unpaid bill absorb a refund credit. Shares the credit fully covers are marked paid. */
export async function applyRefund(refundId: number, billId: number): Promise<BillDto> {
  const refund = await getRefund(refundId)
  if (refund.appliedToBillId) throw createError({ statusCode: 409, statusMessage: 'That credit has already been used.' })
  const bill = await getBill(billId)
  if (bill.id === refund.billId || !canEditBill(bill) || bill.cardPaidAt || !onSharedCard(bill) || bill.credit) {
    throw createError({ statusCode: 409, statusMessage: 'A credit can only go on an unpaid shared-card bill that has no other credit.' })
  }
  const credit = { amountCents: refund.amountCents, shares: refund.shares }
  if (!canAbsorb(bill, credit)) {
    throw createError({ statusCode: 422, statusMessage: 'This bill is too small to absorb the whole credit.' })
  }
  const covered = bill.participants.filter(p => shareDue(p, credit) === 0).map(p => p.userId)

  await useDb().transaction(async (tx) => {
    // Conditional update so two simultaneous applies cannot both win.
    const [res] = await tx.update(refunds)
      .set({ appliedToBillId: billId, appliedAt: new Date() })
      .where(and(eq(refunds.id, refundId), isNull(refunds.appliedToBillId)))
    if (res.affectedRows !== 1) throw createError({ statusCode: 409, statusMessage: 'That credit has already been used.' })
    if (covered.length) {
      await tx.update(billParticipants)
        .set({ paidAt: new Date() })
        .where(and(eq(billParticipants.billId, billId), inArray(billParticipants.userId, covered), isNull(billParticipants.paidAt)))
    }
  }).catch((e) => {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'This bill already has a credit.' })
    throw e
  })
  if (covered.length) await notifyIfCardReady(billId)
  return getBill(billId)
}

/** Put a credit back to unused. Allowed until someone pays real money on the bill it went to. */
export async function unapplyRefund(refundId: number): Promise<void> {
  const refund = await getRefund(refundId)
  if (!refund.appliedToBillId) return
  const bill = await getBill(refund.appliedToBillId)
  const credit = { amountCents: refund.amountCents, shares: refund.shares }
  if (bill.cardPaidAt || bill.participants.some(p => p.paidAt && shareDue(p, credit) > 0)) {
    throw createError({ statusCode: 409, statusMessage: 'Someone already paid that bill, so the credit can no longer be moved.' })
  }
  const autoPaid = bill.participants.filter(p => p.paidAt).map(p => p.userId)
  await useDb().transaction(async (tx) => {
    if (autoPaid.length) {
      await tx.update(billParticipants).set({ paidAt: null }).where(and(eq(billParticipants.billId, bill.id), inArray(billParticipants.userId, autoPaid)))
    }
    await tx.update(refunds).set({ appliedToBillId: null, appliedAt: null }).where(eq(refunds.id, refundId))
  })
}

export async function deleteRefund(refundId: number): Promise<void> {
  const refund = await getRefund(refundId)
  if (refund.appliedToBillId) throw createError({ statusCode: 409, statusMessage: 'Unapply the credit before deleting the refund.' })
  await useDb().delete(refunds).where(eq(refunds.id, refundId))
}
