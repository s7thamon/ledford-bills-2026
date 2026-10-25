import { beforeEach, describe, expect, it } from 'vitest'
import { createBill, deleteBill, getBill, markCardPaid, markParticipantPaid, setPaidWithCard, updateBill } from '../server/services/bills'
import { applyRefund, deleteRefund, listRefunds, recordRefund, unapplyRefund } from '../server/services/refunds'
import { sentMail } from '../server/utils/mail'
import { canMarkCardPaid } from '../shared/utils/rules'
import { cardDue, shareDue } from '../shared/utils/credits'
import { expectHttpError, flushMail, resetDb, seedUsers } from './helpers'

let tim: number, kelly: number

beforeEach(async () => {
  await resetDb()
  ;({ tim, kelly } = await seedUsers())
})

async function paidBill(name: string, amountCents: number, card = true) {
  const bill = await createBill({ name, amountCents, createdBy: tim, addedOn: '2026-10-05' })
  await markParticipantPaid(bill.id, tim, tim, false)
  await markParticipantPaid(bill.id, kelly, kelly, false)
  if (card) await markCardPaid(bill.id)
  return bill
}

async function settle() {
  await flushMail()
  sentMail.length = 0
}

describe('refunds', () => {
  it('records proportional credits', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    expect(refund.shares).toEqual({ [tim]: 15000, [kelly]: 15000 })
    expect((await getBill(rug.id)).refunds[0]!.amountCents).toBe(30000)
  })

  it('over-refund rejected', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    await expectHttpError(recordRefund(rug.id, { amountCents: 1, refundedOn: '2026-11-02' }, tim), 422)
  })

  it('refund needs a paid bill', async () => {
    const bill = await createBill({ name: 'Unpaid', amountCents: 1000, createdBy: tim })
    await expectHttpError(recordRefund(bill.id, { amountCents: 500, refundedOn: '2026-11-02' }, tim), 409)
  })

  it('applies to an absorbing bill and reduces amounts due', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    const bill = await applyRefund(refund.id, replacement.id)
    expect(bill.credit).toMatchObject({ refundId: refund.id, amountCents: 30000, sourceBillId: rug.id, sourceName: 'Costco Rug' })
    expect(bill.participants.map(p => shareDue(p, bill.credit))).toEqual([1000, 1000])
    expect(cardDue(bill)).toBe(2000)
    expect((await getBill(rug.id)).refunds[0]).toMatchObject({ appliedToBillId: replacement.id, appliedToName: 'Rug 2' })
  })

  it('rejects bills that cannot absorb the credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const small = await createBill({ name: 'Small', amountCents: 1000, createdBy: tim })
    await expectHttpError(applyRefund(refund.id, small.id), 422)
  })

  it('apply is single-use', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const lamp = await paidBill('Lamp', 4000)
    const r1 = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const r2 = await recordRefund(lamp.id, { amountCents: 4000, refundedOn: '2026-11-02' }, tim)
    const a = await createBill({ name: 'A', amountCents: 40000, createdBy: tim })
    const b = await createBill({ name: 'B', amountCents: 40000, createdBy: tim })
    await applyRefund(r1.id, a.id)
    await expectHttpError(applyRefund(r1.id, b.id), 409)
    await expectHttpError(applyRefund(r2.id, a.id), 409)
  })

  it('zero share auto-paid', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const same = await createBill({ name: 'Same price', amountCents: 30000, createdBy: tim })
    await settle()
    const bill = await applyRefund(refund.id, same.id)
    expect(bill.participants.every(p => p.paidAt)).toBe(true)
    await flushMail()
    expect(sentMail.filter(m => m.subject.startsWith('Card Ready to Pay')).map(m => m.to)).toEqual(['kelly@example.com'])
  })

  it('edit returns credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyRefund(refund.id, replacement.id)
    expect((await updateBill(replacement.id, { amountCents: 40000 })).credit).toBeNull()
    expect((await listRefunds())[0]!.appliedToBillId).toBeNull()
  })

  it('renaming with the same amounts keeps the credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyRefund(refund.id, replacement.id)
    const renamed = await updateBill(replacement.id, { name: 'Rug (replacement)', amountCents: 32000, splits: { [tim]: 16000, [kelly]: 16000 } })
    expect(renamed.credit?.refundId).toBe(refund.id)
  })

  it('delete returns credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyRefund(refund.id, replacement.id)
    await deleteBill(replacement.id)
    expect((await listRefunds())[0]!.appliedToBillId).toBeNull()
  })

  it('unapply rules', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyRefund(refund.id, replacement.id)
    await unapplyRefund(refund.id)
    expect((await getBill(replacement.id)).credit).toBeNull()
    await applyRefund(refund.id, replacement.id)
    await markParticipantPaid(replacement.id, tim, tim, false)
    await expectHttpError(unapplyRefund(refund.id), 409)
    await expectHttpError(deleteRefund(refund.id), 409)
  })

  it('unapply clears shares the credit auto-paid', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const same = await createBill({ name: 'Same price', amountCents: 30000, createdBy: tim })
    await applyRefund(refund.id, same.id)
    await unapplyRefund(refund.id)
    expect((await getBill(same.id)).participants.every(p => !p.paidAt)).toBe(true)
  })

  it('deletes an unapplied refund', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    await deleteRefund(refund.id)
    expect(await listRefunds()).toEqual([])
  })

  it('different card skips card ready', async () => {
    const bill = await createBill({ name: 'Oops personal', amountCents: 1000, createdBy: tim })
    await setPaidWithCard(bill.id, tim)
    await settle()
    await markParticipantPaid(bill.id, tim, tim, false)
    await markParticipantPaid(bill.id, kelly, kelly, false)
    await flushMail()
    expect(sentMail.filter(m => m.subject.startsWith('Card Ready to Pay'))).toHaveLength(0)
    await expectHttpError(markCardPaid(bill.id), 409)
    await expectHttpError(recordRefund(bill.id, { amountCents: 500, refundedOn: '2026-11-02' }, tim), 409)
    const cleared = await setPaidWithCard(bill.id, null)
    expect(canMarkCardPaid(cleared)).toBe(true)
    await expectHttpError(setPaidWithCard(bill.id, 999), 422)
  })

  it('cannot apply a credit to a different-card bill', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const personal = await createBill({ name: 'Personal', amountCents: 40000, createdBy: tim })
    await setPaidWithCard(personal.id, kelly)
    await expectHttpError(applyRefund(refund.id, personal.id), 409)
  })

  it('no refund emails', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await settle()
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    await applyRefund(refund.id, replacement.id)
    await flushMail()
    expect(sentMail).toHaveLength(0)
  })
})
