import { beforeEach, describe, expect, it } from 'vitest'
import { createBill, countUnpaidInMonth, unpaidByMonth, deleteBill, getBill, listBills, markCardPaid, markParticipantPaid, paySelected, updateBill, billNameSuggestions, searchBills } from '../server/services/bills'
import { sentMail } from '../server/utils/mail'
import { expectHttpError, flushMail, resetDb, seedUsers } from './helpers'

let tim: number, kelly: number

beforeEach(async () => {
  await resetDb()
  ;({ tim, kelly } = await seedUsers())
})

describe('bills', () => {
  it('splits new bills evenly, rounding up, and emails each participant', async () => {
    const bill = await createBill({ name: 'Food Lion', amountCents: 4765, createdBy: tim, addedOn: '2026-10-21' })
    expect(bill.participants.map(p => p.amountCents)).toEqual([2383, 2383])
    await flushMail()
    expect(sentMail.filter(m => m.subject.startsWith('New Bill Added')).map(m => m.to).sort()).toEqual(['kelly@example.com', 'tim@example.com'])
  })

  it('lists by month with unpaid filters', async () => {
    const a = await createBill({ name: 'A', amountCents: 1000, createdBy: tim, addedOn: '2026-10-01' })
    await createBill({ name: 'B', amountCents: 1000, createdBy: tim, addedOn: '2026-09-30' })
    await markParticipantPaid(a.id, tim, tim, false)
    expect((await listBills({ month: '2026-10', userId: tim })).map(b => b.name)).toEqual(['A'])
    expect(await listBills({ month: '2026-10', userId: tim, userUnpaid: true })).toHaveLength(0)
    expect(await listBills({ month: '2026-10', userId: kelly, userUnpaid: true })).toHaveLength(1)
  })

  it('resets to an even split when only the amount changes, and accepts custom splits that cover the total', async () => {
    const bill = await createBill({ name: 'Costco', amountCents: 1000, createdBy: tim })
    expect((await updateBill(bill.id, { amountCents: 2001 })).participants.map(p => p.amountCents)).toEqual([1001, 1001])
    const custom = await updateBill(bill.id, { splits: { [tim]: 2001, [kelly]: 0 } })
    expect(custom.participants.find(p => p.userId === tim)!.amountCents).toBe(2001)
    await expectHttpError(updateBill(bill.id, { splits: { [tim]: 1000, [kelly]: 0 } }), 422)
  })

  it('locks edits and deletes once someone pays', async () => {
    const bill = await createBill({ name: 'Locked', amountCents: 1000, createdBy: tim })
    await markParticipantPaid(bill.id, kelly, kelly, false)
    await expectHttpError(updateBill(bill.id, { name: 'Nope' }), 409)
    await expectHttpError(deleteBill(bill.id), 409)
  })

  it('deletes unpaid bills', async () => {
    const bill = await createBill({ name: 'Oops', amountCents: 1000, createdBy: tim })
    await deleteBill(bill.id)
    await expectHttpError(getBill(bill.id), 404)
  })

  it('only lets you mark someone else paid in admin mode', async () => {
    const bill = await createBill({ name: 'X', amountCents: 1000, createdBy: tim })
    await expectHttpError(markParticipantPaid(bill.id, kelly, tim, false), 403)
    expect(await markParticipantPaid(bill.id, kelly, tim, true)).toBe(true)
    expect(await markParticipantPaid(bill.id, kelly, tim, true)).toBe(false)
  })

  it('needs everyone paid before the card, then emails only the card owner', async () => {
    const bill = await createBill({ name: 'Card', amountCents: 1000, createdBy: tim })
    await markParticipantPaid(bill.id, tim, tim, false)
    await expectHttpError(markCardPaid(bill.id), 409)
    sentMail.length = 0
    await markParticipantPaid(bill.id, kelly, kelly, false)
    await flushMail()
    expect(sentMail.map(m => [m.to, m.subject])).toEqual([['kelly@example.com', 'Card Ready to Pay - "Card" - $10.00']])
    await markCardPaid(bill.id)
    await expectHttpError(markCardPaid(bill.id), 409)
  })

  it('bulk pays my shares and then the card', async () => {
    const a = await createBill({ name: 'A', amountCents: 1000, createdBy: tim })
    const b = await createBill({ name: 'B', amountCents: 1000, createdBy: tim })
    expect(await paySelected([a.id, b.id], tim, 'me')).toBe(2)
    expect(await paySelected([a.id, b.id], tim, 'card')).toBe(0)
    await markParticipantPaid(a.id, kelly, kelly, false)
    expect(await paySelected([a.id, b.id], tim, 'card')).toBe(1)
    expect((await getBill(a.id)).cardPaidAt).not.toBeNull()
  })

  it('counts unpaid bills per month', async () => {
    const a = await createBill({ name: 'A', amountCents: 1000, createdBy: tim, addedOn: '2026-09-05' })
    await createBill({ name: 'B', amountCents: 1000, createdBy: tim, addedOn: '2026-09-06' })
    await paySelected([a.id], tim, 'me')
    await paySelected([a.id], kelly, 'me')
    await markCardPaid(a.id)
    expect(await countUnpaidInMonth('2026-09')).toBe(1)
    expect(await unpaidByMonth('2026-08', '2026-10')).toEqual({ '2026-09': 1 })
  })

  it('suggests repeated names and searches with escaped wildcards', async () => {
    await createBill({ name: 'Food Lion', amountCents: 100, createdBy: tim })
    await createBill({ name: 'Food Lion', amountCents: 200, createdBy: tim })
    await createBill({ name: '100% Juice', amountCents: 300, createdBy: tim })
    expect(await billNameSuggestions()).toEqual(['Food Lion'])
    expect((await searchBills('food')).length).toBe(2)
    expect((await searchBills('%')).map(b => b.name)).toEqual(['100% Juice'])
    expect(await searchBills('  ')).toEqual([])
  })
})
