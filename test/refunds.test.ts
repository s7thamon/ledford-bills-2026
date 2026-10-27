import { beforeEach, describe, expect, it } from 'vitest'
import { countUnpaidInMonth, createBill, deleteBill, getBill, listBills, markCardPaid, markParticipantPaid, setPaidByCheck, updateBill } from '../server/services/bills'
import { applyCredit, deleteRefund, listRefunds, recordRefund, removeCredit } from '../server/services/refunds'
import { sentMail } from '../server/utils/mail'
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

const creditLeft = async () => (await listRefunds()).reduce((sum, r) => sum + r.leftCents, 0)

describe('refunds', () => {
  it('records proportional credits', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    expect(refund.shares).toEqual({ [tim]: 15000, [kelly]: 15000 })
    expect(refund).toMatchObject({ leftCents: 30000, left: { [tim]: 15000, [kelly]: 15000 }, uses: [] })
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

  it('applies to a bigger bill and reduces amounts due', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    const bill = await applyCredit(replacement.id)
    expect(bill.credit).toMatchObject({ amountCents: 30000, shares: { [tim]: 15000, [kelly]: 15000 } })
    expect(bill.credit!.sources).toMatchObject([{ refundId: refund.id, sourceBillId: rug.id, sourceName: 'Costco Rug', amountCents: 30000 }])
    expect(bill.participants.map(p => shareDue(p, bill.credit))).toEqual([1000, 1000])
    expect(cardDue(bill)).toBe(2000)
    expect((await getBill(rug.id)).refunds[0]!.uses).toMatchObject([{ billName: 'Rug 2', amountCents: 30000 }])
    expect(await creditLeft()).toBe(0)
  })

  it('a small bill takes a bite and the rest stays', async () => {
    const tv = await paidBill('Costco TV', 300000)
    await recordRefund(tv.id, { amountCents: 300000, refundedOn: '2026-10-12' }, tim)
    const kroger = await createBill({ name: 'Kroger', amountCents: 21248, createdBy: tim })
    const bill = await applyCredit(kroger.id)
    expect(bill.participants.every(p => p.paidAt)).toBe(true)
    expect(cardDue(bill)).toBe(0)
    const [refund] = await listRefunds()
    expect(refund).toMatchObject({ leftCents: 278752, left: { [tim]: 139376, [kelly]: 139376 } })
    expect(refund!.uses).toMatchObject([{ billId: kroger.id, billName: 'Kroger', amountCents: 21248, shares: { [tim]: 10624, [kelly]: 10624 }, removable: true }])
  })

  it('the last bite takes only what is left', async () => {
    const rug = await paidBill('Rug', 9000)
    await recordRefund(rug.id, { amountCents: 9000, refundedOn: '2026-10-12' }, tim)
    const lowes = await createBill({ name: "Lowe's", amountCents: 20000, createdBy: tim })
    const bill = await applyCredit(lowes.id)
    expect(bill.participants.map(p => shareDue(p, bill.credit))).toEqual([5500, 5500])
    expect(cardDue(bill)).toBe(11000)
    expect(bill.participants.every(p => !p.paidAt)).toBe(true)
  })

  it('a bite spans two refunds, oldest first', async () => {
    const a = await paidBill('A', 6000)
    const b = await paidBill('B', 50000)
    const ra = await recordRefund(a.id, { amountCents: 6000, refundedOn: '2026-10-01' }, tim)
    const rb = await recordRefund(b.id, { amountCents: 50000, refundedOn: '2026-10-02' }, tim)
    const bill = await applyCredit((await createBill({ name: 'C', amountCents: 20000, createdBy: tim })).id)
    expect(bill.credit!.sources.map(s => [s.refundId, s.amountCents])).toEqual([[ra.id, 6000], [rb.id, 14000]])
    expect(await creditLeft()).toBe(36000)
  })

  it('a bill takes credit once, and nothing when none is left', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const a = await createBill({ name: 'A', amountCents: 40000, createdBy: tim })
    const b = await createBill({ name: 'B', amountCents: 40000, createdBy: tim })
    await applyCredit(a.id)
    await expectHttpError(applyCredit(a.id), 409)
    await expectHttpError(applyCredit(b.id), 409)
  })

  it('two applies cannot overspend', async () => {
    const rug = await paidBill('Rug', 10000)
    await recordRefund(rug.id, { amountCents: 10000, refundedOn: '2026-10-12' }, tim)
    const a = await createBill({ name: 'A', amountCents: 10000, createdBy: tim })
    const b = await createBill({ name: 'B', amountCents: 10000, createdBy: tim })
    const results = await Promise.allSettled([applyCredit(a.id), applyCredit(b.id)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await creditLeft()).toBe(0)
  })

  it('zero share auto-paid', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const same = await createBill({ name: 'Same price', amountCents: 30000, createdBy: tim })
    await settle()
    const bill = await applyCredit(same.id)
    expect(bill.participants.every(p => p.paidAt)).toBe(true)
    await flushMail()
    expect(sentMail.filter(m => m.subject.startsWith('Card Ready to Pay')).map(m => m.to)).toEqual(['kelly@example.com'])
  })

  it('edit returns credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyCredit(replacement.id)
    expect((await updateBill(replacement.id, { amountCents: 40000 })).credit).toBeNull()
    expect(await creditLeft()).toBe(30000)
  })

  it('renaming with the same amounts keeps the credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyCredit(replacement.id)
    const renamed = await updateBill(replacement.id, { name: 'Rug (replacement)', amountCents: 32000, splits: { [tim]: 16000, [kelly]: 16000 } })
    expect(renamed.credit?.sources[0]?.refundId).toBe(refund.id)
  })

  it('a bill whose shares the credit covered can still be edited, returning the credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const same = await createBill({ name: 'Same price', amountCents: 30000, createdBy: tim })
    await applyCredit(same.id)
    const edited = await updateBill(same.id, { amountCents: 50000 })
    expect(edited.credit).toBeNull()
    expect(edited.participants.every(p => !p.paidAt)).toBe(true)
    expect(await creditLeft()).toBe(30000)
  })

  it('a refunded bill cannot switch to check', async () => {
    const rug = await paidBill('Costco Rug', 30000, false)
    await recordRefund(rug.id, { amountCents: 10000, refundedOn: '2026-11-02' }, tim)
    await expectHttpError(setPaidByCheck(rug.id, true), 409)
  })

  it('delete returns credit', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyCredit(replacement.id)
    await deleteBill(replacement.id)
    expect(await creditLeft()).toBe(30000)
  })

  it('remove rules', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await applyCredit(replacement.id)
    await removeCredit(replacement.id)
    expect((await getBill(replacement.id)).credit).toBeNull()
    await applyCredit(replacement.id)
    await markParticipantPaid(replacement.id, tim, tim, false)
    await expectHttpError(removeCredit(replacement.id), 409)
    expect((await listRefunds())[0]!.uses[0]!.removable).toBe(false)
    await expectHttpError(deleteRefund(refund.id), 409)
  })

  it('remove clears shares the credit auto-paid', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const same = await createBill({ name: 'Same price', amountCents: 30000, createdBy: tim })
    await applyCredit(same.id)
    await removeCredit(same.id)
    expect((await getBill(same.id)).participants.every(p => !p.paidAt)).toBe(true)
  })

  it('deletes an unused refund', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    await deleteRefund(refund.id)
    expect(await listRefunds()).toEqual([])
  })

  it('check bills: no refund, no credit, no card', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    const check = await createBill({ name: 'Baker Home', amountCents: 40000, createdBy: tim, addedOn: '2026-09-05' })
    expect((await setPaidByCheck(check.id, true)).paidByCheck).toBe(true)
    await expectHttpError(applyCredit(check.id), 409)
    await markParticipantPaid(check.id, tim, tim, false)
    await markParticipantPaid(check.id, kelly, kelly, false)
    await expectHttpError(markCardPaid(check.id), 409)
    await expectHttpError(recordRefund(check.id, { amountCents: 500, refundedOn: '2026-11-02' }, tim), 409)
    expect(await countUnpaidInMonth('2026-09')).toBe(0)
  })

  it('the cardUnpaid filter skips check bills', async () => {
    const shared = await createBill({ name: 'Shared', amountCents: 1000, createdBy: tim, addedOn: '2026-09-05' })
    const check = await createBill({ name: 'Check', amountCents: 1000, createdBy: tim, addedOn: '2026-09-06' })
    await setPaidByCheck(check.id, true)
    expect((await listBills({ month: '2026-09', userId: tim, cardUnpaid: true })).map(b => b.id)).toEqual([shared.id])
  })

  it('no refund emails', async () => {
    const rug = await paidBill('Costco Rug', 30000)
    const replacement = await createBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim })
    await settle()
    await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-11-02' }, tim)
    await applyCredit(replacement.id)
    await flushMail()
    expect(sentMail).toHaveLength(0)
  })

  it('no refunds or credit on paid directly bills', async () => {
    const mortgage = await paidBill('Ledford Mortgage', 188000, false)
    await expectHttpError(recordRefund(mortgage.id, { amountCents: 100, refundedOn: '2026-10-12' }, tim), 409)
    const tv = await paidBill('TV', 300000)
    await recordRefund(tv.id, { amountCents: 300000, refundedOn: '2026-10-12' }, tim)
    const next = await createBill({ name: 'ledford mortgage', amountCents: 188000, createdBy: tim })
    await expectHttpError(applyCredit(next.id), 409)
  })

  it('rug chain: a refunded bill keeps its bite', async () => {
    const a = await paidBill('Rug A', 30000)
    await recordRefund(a.id, { amountCents: 30000, refundedOn: '2026-10-12' }, tim)
    const b = await createBill({ name: 'Rug B', amountCents: 30000, createdBy: tim })
    await applyCredit(b.id)
    await recordRefund(b.id, { amountCents: 30000, refundedOn: '2026-10-20' }, tim)
    await expectHttpError(removeCredit(b.id), 409)
    await expectHttpError(updateBill(b.id, { amountCents: 40000 }), 409)
    await expectHttpError(setPaidByCheck(b.id, true), 409)
    expect(await creditLeft()).toBe(30000)
  })

  it('rug chain with deposits: a $320 refund leaves $160 each', async () => {
    const a = await paidBill('Rug A', 30000)
    await recordRefund(a.id, { amountCents: 30000, refundedOn: '2026-10-12' }, tim)
    const b = await createBill({ name: 'Rug B', amountCents: 32000, createdBy: tim })
    await applyCredit(b.id)
    await markParticipantPaid(b.id, tim, tim, false)
    await markParticipantPaid(b.id, kelly, kelly, false)
    await markCardPaid(b.id)
    const refund = await recordRefund(b.id, { amountCents: 32000, refundedOn: '2026-10-20' }, tim)
    expect(refund.shares).toEqual({ [tim]: 16000, [kelly]: 16000 })
    expect(await creditLeft()).toBe(32000)
  })

  it('switching to check returns an unpaid bite, and is blocked after a deposit', async () => {
    const rug = await paidBill('Rug', 9000)
    await recordRefund(rug.id, { amountCents: 9000, refundedOn: '2026-10-12' }, tim)
    const lowes = await createBill({ name: "Lowe's", amountCents: 20000, createdBy: tim })
    await applyCredit(lowes.id)
    const check = await setPaidByCheck(lowes.id, true)
    expect(check.credit).toBeNull()
    expect(await creditLeft()).toBe(9000)
    const home = await createBill({ name: 'Home Depot', amountCents: 20000, createdBy: tim })
    await applyCredit(home.id)
    await markParticipantPaid(home.id, tim, tim, false)
    await expectHttpError(setPaidByCheck(home.id, true), 409)
  })

  it('admin delete of a paid bill returns its bite', async () => {
    const rug = await paidBill('Rug', 5000)
    await recordRefund(rug.id, { amountCents: 5000, refundedOn: '2026-10-12' }, tim)
    const bb = await createBill({ name: 'Best Buy', amountCents: 20000, createdBy: tim })
    await applyCredit(bb.id)
    await markParticipantPaid(bb.id, tim, tim, false)
    await markParticipantPaid(bb.id, kelly, kelly, false)
    await expectHttpError(deleteBill(bb.id), 403)
    await deleteBill(bb.id, true)
    await expectHttpError(getBill(bb.id), 404)
    expect(await creditLeft()).toBe(5000)
  })

  it('admin delete is refused for a paid card, a check, or a refund that was used', async () => {
    const carded = await paidBill('Carded', 5000)
    await expectHttpError(deleteBill(carded.id, true), 409)
    const check = await createBill({ name: 'Check', amountCents: 5000, createdBy: tim })
    await setPaidByCheck(check.id, true)
    await markParticipantPaid(check.id, tim, tim, false)
    await expectHttpError(deleteBill(check.id, true), 409)
    const source = await paidBill('Source', 5000, false)
    await recordRefund(source.id, { amountCents: 5000, refundedOn: '2026-10-12' }, tim)
    await applyCredit((await createBill({ name: 'Uses it', amountCents: 5000, createdBy: tim })).id)
    await expectHttpError(deleteBill(source.id, true), 409)
  })

  it('admin delete takes an unused refund with it', async () => {
    const source = await paidBill('Source', 5000, false)
    await recordRefund(source.id, { amountCents: 5000, refundedOn: '2026-10-12' }, tim)
    await deleteBill(source.id, true)
    expect(await listRefunds()).toEqual([])
  })
})
