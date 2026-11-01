import { beforeEach, describe, expect, it } from 'vitest'
import { createBill, getBill, listBills, markCardPaid, markParticipantPaid } from '../server/services/bills'
import { cancelHeldBill, holdBill, listHeldBills, releaseHeldBills, updateHeldBill } from '../server/services/held-bills'
import { createRecurring, generateRecurring } from '../server/services/recurring'
import { applyCredit, listRefunds, recordRefund } from '../server/services/refunds'
import { sentMail } from '../server/utils/mail'
import { isMonthEnd } from '../shared/utils/dates'
import { expectHttpError, flushMail, resetDb, seedUsers } from './helpers'

let tim: number, kelly: number

beforeEach(async () => {
  await resetDb()
  ;({ tim, kelly } = await seedUsers())
})

const creditLeft = async () => (await listRefunds()).map(r => [r.id, r.leftCents, r.left])

/** A paid, card-paid October bill refunded in full: credit waiting to be used. */
async function refundedRug() {
  const rug = await createBill({ name: 'Costco Rug', amountCents: 30000, createdBy: tim, addedOn: '2026-10-05' })
  await markParticipantPaid(rug.id, tim, tim, false)
  await markParticipantPaid(rug.id, kelly, kelly, false)
  await markCardPaid(rug.id)
  return recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-10-20' }, tim)
}

describe('held bills', () => {
  it('asks only on the last 2 days of the month', () => {
    expect(['2026-10-29', '2026-10-30', '2026-10-31'].map(isMonthEnd)).toEqual([false, true, true])
    expect(['2026-11-28', '2026-11-29', '2026-11-30'].map(isMonthEnd)).toEqual([false, true, true])
    expect(['2028-02-27', '2028-02-28', '2028-02-29'].map(isMonthEnd)).toEqual([false, true, true])
  })

  it('is held for the 1st of next month and is not an October bill', async () => {
    const held = await holdBill({ name: ' Amazon order ', amountCents: 6210, createdBy: tim }, '2026-10-31')
    expect(held).toMatchObject({ name: 'Amazon order', addOn: '2026-11-01' })
    expect(await holdBill({ name: 'Gift', amountCents: 100, createdBy: tim }, '2026-12-30')).toMatchObject({ addOn: '2027-01-01' })
    expect(await listBills({ month: '2026-10', userId: tim })).toEqual([])
    await flushMail()
    expect(sentMail).toEqual([])
  })

  it('adds held bills on the 1st after the recurring bills, exactly once', async () => {
    await createRecurring({ type: 'bill', name: 'Internet', amountCents: 8000, dayOfMonth: 1 }, tim)
    await holdBill({ name: 'Amazon order', amountCents: 6210, createdBy: kelly }, '2026-10-31')

    expect(await releaseHeldBills('2026-10-31')).toBe(0)
    // The task's order: recurring first, then held.
    expect(await generateRecurring('2026-11-01')).toBe(1)
    expect(await releaseHeldBills('2026-11-01')).toBe(1)
    expect(await releaseHeldBills('2026-11-01')).toBe(0)

    const nov = await listBills({ month: '2026-11', userId: tim })
    // Newest first, so the held bill sits above Internet: added after it.
    expect(nov.map(b => [b.name, b.addedOn])).toEqual([['Amazon order', '2026-11-01'], ['Internet', '2026-11-01']])
    expect(nov[0]!.participants.map(p => [p.userId, p.amountCents, p.paidAt])).toEqual([[tim, 3105, null], [kelly, 3105, null]])
    expect(await listHeldBills()).toEqual([])
  })

  it('catches up after a missed night, still dated the 1st', async () => {
    await holdBill({ name: 'Target', amountCents: 2210, createdBy: tim }, '2026-10-30')
    expect(await releaseHeldBills('2026-11-03')).toBe(1)
    expect((await listBills({ month: '2026-11', userId: tim })).map(b => b.addedOn)).toEqual(['2026-11-01'])
  })

  it('edits and cancels before the 1st', async () => {
    const a = await holdBill({ name: 'Amazon', amountCents: 6210, createdBy: tim }, '2026-10-31')
    const b = await holdBill({ name: 'Target', amountCents: 2210, createdBy: tim }, '2026-10-31')
    expect(await updateHeldBill(a.id, { name: 'Amazon order', amountCents: 6500 })).toMatchObject({ name: 'Amazon order', amountCents: 6500 })
    await cancelHeldBill(b.id)
    await expectHttpError(cancelHeldBill(b.id), 404)
    await releaseHeldBills('2026-11-01')
    expect((await listBills({ month: '2026-11', userId: tim })).map(b => [b.name, b.amountCents])).toEqual([['Amazon order', 6500]])
  })

  it('never touches refund credit while held or when added', async () => {
    await refundedRug()
    const before = await creditLeft()
    const held = await holdBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim }, '2026-10-31')
    await updateHeldBill(held.id, { name: 'Rug 2', amountCents: 31000 })
    expect(await creditLeft()).toEqual(before)

    await releaseHeldBills('2026-11-01')
    expect(await creditLeft()).toEqual(before)
    const [added] = await listBills({ month: '2026-11', userId: tim })
    expect(added!.credit).toBeNull()

    // It takes credit later like any November bill.
    const credited = await applyCredit(added!.id)
    expect(credited.credit).toMatchObject({ amountCents: 30000 })
    expect((await listRefunds())[0]!.leftCents).toBe(0)
  })

  it('cancelling a held bill leaves credit alone', async () => {
    await refundedRug()
    const before = await creditLeft()
    const held = await holdBill({ name: 'Rug 2', amountCents: 32000, createdBy: tim }, '2026-10-31')
    await cancelHeldBill(held.id)
    expect(await creditLeft()).toEqual(before)
    expect((await getBill((await listRefunds())[0]!.billId)).refunds[0]!.uses).toEqual([])
  })
})
