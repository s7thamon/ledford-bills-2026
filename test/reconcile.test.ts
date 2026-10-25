import { describe, expect, it } from 'vitest'
import { findSubset, matchCharges, matchPayments, parseCitiCsv, storeKey, type ReconcileBill, type StatementLine } from '../shared/utils/reconcile'

const bill = (id: number, amountCents: number, addedOn: string, extra: Partial<ReconcileBill> = {}): ReconcileBill =>
  ({ id, name: `Bill ${id}`, amountCents, addedOn, cardPaidAt: null, cardDueCents: amountCents, ...extra })
const line = (id: string, amountCents: number, date: string, description: string, kind: StatementLine['kind'] = 'charge'): StatementLine =>
  ({ id, status: 'Cleared', date, description, amountCents, kind })

describe('parseCitiCsv', () => {
  it('parses charges, payments and refunds with quoted commas', () => {
    const csv = [
      'Status,Date,Description,Debit,Credit',
      'Cleared,09/01/2026,"WWW COSTCO COM ISSAQUAH WA",51.22,',
      'Cleared,09/09/2026,"ONLINE PAYMENT, THANK YOU",,-21.21',
      'Cleared,09/18/2026,"WWW COSTCO COM ISSAQUAH WA",,-51.22'
    ].join('\n')
    const { lines, from, to } = parseCitiCsv(csv)
    expect(lines.map(l => [l.amountCents, l.kind])).toEqual([[5122, 'charge'], [-2121, 'payment'], [-5122, 'refund']])
    expect(lines[1]!.description).toBe('ONLINE PAYMENT, THANK YOU')
    expect([from, to]).toEqual(['2026-09-01', '2026-09-18'])
  })
  it('parses the newer unquoted dollar amounts with thousands commas', () => {
    const csv = [
      'Status,Date,Description,Debit,Credit',
      'Cleared,10/21/2026,"ONLINE PAYMENT, THANK YOU",, -$ 1,134.19',
      'Cleared,10/21/2026,"FOOD LION #0149 CLAYTON NC",$ 47.64,',
      'Cleared,10/01/2026,"MORTGAGE",$ 1,880.00,'
    ].join('\n')
    expect(parseCitiCsv(csv).lines.map(l => l.amountCents)).toEqual([-113419, 4764, 188000])
  })
  it('rejects other files', () => {
    expect(() => parseCitiCsv('Date,Amount\n2026-09-01,5')).toThrow(/Citi/)
  })
})

describe('storeKey', () => {
  it('normalizes store names', () => {
    expect(storeKey('AMAZON RETA* 5N6Z00K51 SEATTLE WA')).toBe('AMAZON')
    expect(storeKey('AMAZON MKTPL*533X11PV0 SEATTLE WA')).toBe('AMAZON')
    expect(storeKey('WWW COSTCO COM ISSAQUAH WA')).toBe('COSTCO')
    expect(storeKey('FOOD LION #0149 CLAYTON NC')).toBe('FOOD LION')
  })
})

describe('findSubset', () => {
  it('finds an exact sum, preferring fewer items', () => {
    const items = [{ id: 'a', cents: 5000 }, { id: 'b', cents: 2500 }, { id: 'c', cents: 2500 }, { id: 'd', cents: 7500 }]
    // 7500 + 2500 beats 5000 + 2500 + 2500
    expect(findSubset(items, 10000, 2, 4)).toEqual(['b', 'd'])
    expect(findSubset(items, 1, 2, 4)).toBeNull()
  })
})

describe('matchCharges', () => {
  it('breaks ties by closest date and leaves the other line over', () => {
    const lines = [line('1', 5122, '2026-09-01', 'WWW COSTCO COM'), line('2', 5122, '2026-09-02', 'WWW COSTCO COM')]
    const r = matchCharges(lines, [bill(10, 5122, '2026-09-02')], [])
    expect(r.exact).toEqual([{ lineIds: ['2'], billId: 10 }])
    expect(r.leftoverLines).toEqual(['1'])
  })
  it('suggests split charges from the same store', () => {
    const lines = [line('1', 7500, '2026-09-07', 'AMAZON RETA* X'), line('2', 2500, '2026-09-08', 'AMAZON MKTPL*Y'), line('3', 2500, '2026-09-08', 'FOOD LION #1')]
    const r = matchCharges(lines, [bill(10, 10000, '2026-09-07')], [])
    expect(r.exact).toEqual([])
    expect(r.suggestions).toEqual([{ lineIds: ['1', '2'], billId: 10 }])
    expect(r.leftoverLines).toEqual(['3'])
    expect(r.leftoverBills).toEqual([])
  })
  it('matches refund lines to recorded refunds', () => {
    const lines = [line('1', -5122, '2026-09-18', 'WWW COSTCO COM', 'refund')]
    const r = matchCharges(lines, [], [{ id: 7, billId: 3, amountCents: 5122, refundedOn: '2026-09-17' }])
    expect(r.refunds).toEqual([{ lineId: '1', refundId: 7 }])
    expect(r.leftoverLines).toEqual([])
  })
  it('ignores charges outside the window', () => {
    const r = matchCharges([line('1', 1000, '2026-09-20', 'X')], [bill(10, 1000, '2026-09-01')], [])
    expect(r.exact).toEqual([])
  })
})

describe('matchPayments', () => {
  const paid = (id: number, due: number, day: string) => bill(id, due, day, { cardPaidAt: `${day}T12:00:00.000Z`, cardDueCents: due })
  it('matches single and combined payments by card amount', () => {
    const lines = [line('p1', -2121, '2026-09-09', 'ONLINE PAYMENT, THANK YOU', 'payment'), line('p2', -30535, '2026-09-09', 'ONLINE PAYMENT, THANK YOU', 'payment')]
    const r = matchPayments(lines, [paid(1, 2121, '2026-09-08'), paid(2, 27468, '2026-09-08'), paid(3, 3067, '2026-09-08')])
    expect(r.exact).toEqual([{ lineId: 'p1', billIds: [1] }])
    expect(r.suggestions).toEqual([{ lineId: 'p2', billIds: [2, 3] }])
  })
  it('uses the reduced card amount for credited bills', () => {
    const credited = bill(1, 32000, '2026-09-08', { cardPaidAt: '2026-09-08T12:00:00.000Z', cardDueCents: 2000 })
    expect(matchPayments([line('p', -2000, '2026-09-09', 'ONLINE PAYMENT', 'payment')], [credited]).exact).toEqual([{ lineId: 'p', billIds: [1] }])
    expect(matchPayments([line('p', -32000, '2026-09-09', 'ONLINE PAYMENT', 'payment')], [credited]).exact).toEqual([])
  })
  it('skips bills whose card is not paid', () => {
    expect(matchPayments([line('p', -1000, '2026-09-09', 'ONLINE PAYMENT', 'payment')], [bill(1, 1000, '2026-09-08')]).exact).toEqual([])
  })
})

describe('listForReconcile', async () => {
  const { beforeEach } = await import('vitest')
  const { createBill, markCardPaid, markParticipantPaid, setPaidWithCard, listForReconcile } = await import('../server/services/bills')
  const { applyRefund, recordRefund } = await import('../server/services/refunds')
  const { resetDb, seedUsers } = await import('./helpers')
  let tim: number, kelly: number
  beforeEach(async () => {
    await resetDb()
    ;({ tim, kelly } = await seedUsers())
  })
  const payBoth = async (id: number) => {
    await markParticipantPaid(id, tim, tim, false)
    await markParticipantPaid(id, kelly, kelly, false)
  }

  it('returns shared-card bills and refunds for the range', async () => {
    const inside = await createBill({ name: 'Inside', amountCents: 1000, createdBy: tim, addedOn: '2026-09-10' })
    const before = await createBill({ name: 'Paid later', amountCents: 2000, createdBy: tim, addedOn: '2026-07-01' })
    await payBoth(before.id)
    await markCardPaid(before.id)
    // Card paid inside the statement range even though the bill was added months earlier.
    const { useDb, schema } = await import('../server/db/client')
    const { eq } = await import('drizzle-orm')
    await useDb().update(schema.bills).set({ cardPaidAt: new Date('2026-09-12T12:00:00Z') }).where(eq(schema.bills.id, before.id))
    const personal = await createBill({ name: 'Personal', amountCents: 3000, createdBy: tim, addedOn: '2026-09-11' })
    await setPaidWithCard(personal.id, tim)
    await createBill({ name: 'Far away', amountCents: 4000, createdBy: tim, addedOn: '2026-05-01' })
    const { bills } = await listForReconcile('2026-08-01', '2026-09-20')
    expect(bills.map(b => b.name).sort()).toEqual(['Inside', 'Paid later'])
    expect(bills.find(b => b.id === inside.id)).toMatchObject({ amountCents: 1000, cardDueCents: 1000, cardPaidAt: null })
  })

  it('leaves out bills on the paid directly list, which can be edited', async () => {
    const { setDirectPayNames } = await import('../server/services/settings')
    await createBill({ name: 'Ledford Mortgage', amountCents: 188000, createdBy: tim, addedOn: '2026-09-01' })
    await createBill({ name: 'Netflix', amountCents: 3966, createdBy: tim, addedOn: '2026-09-01' })
    expect((await listForReconcile('2026-09-01', '2026-09-20')).bills.map(b => b.name)).toEqual(['Netflix'])
    await setDirectPayNames(['  netflix ', 'netflix', ''])
    expect((await listForReconcile('2026-09-01', '2026-09-20')).bills.map(b => b.name)).toEqual(['Ledford Mortgage'])
  })

  it('reports the reduced card amount and refunds in range', async () => {
    const rug = await createBill({ name: 'Rug', amountCents: 30000, createdBy: tim, addedOn: '2026-09-01' })
    await payBoth(rug.id)
    await markCardPaid(rug.id)
    const refund = await recordRefund(rug.id, { amountCents: 30000, refundedOn: '2026-09-05' }, tim)
    const rep = await createBill({ name: 'Replacement', amountCents: 32000, createdBy: tim, addedOn: '2026-09-06' })
    await applyRefund(refund.id, rep.id)
    const r = await listForReconcile('2026-09-01', '2026-09-20')
    expect(r.bills.find(b => b.id === rep.id)!.cardDueCents).toBe(2000)
    expect(r.refunds).toEqual([{ id: refund.id, billId: rug.id, amountCents: 30000, refundedOn: '2026-09-05' }])
  })

  it('leaves out refunds on personal-card bills', async () => {
    const b = await createBill({ name: 'Personal', amountCents: 5000, createdBy: tim, addedOn: '2026-09-02' })
    await payBoth(b.id)
    const refund = await recordRefund(b.id, { amountCents: 1000, refundedOn: '2026-09-04' }, tim)
    const { useDb, schema } = await import('../server/db/client')
    const { eq } = await import('drizzle-orm')
    // Marked personal after the refund (the app now blocks this order, older data may still have it).
    await useDb().update(schema.bills).set({ paidWithCardOf: tim }).where(eq(schema.bills.id, b.id))
    expect((await listForReconcile('2026-09-01', '2026-09-20')).refunds.map(r => r.id)).not.toContain(refund.id)
  })

  it('creates bills on a given date', async () => {
    expect((await createBill({ name: 'Dated', amountCents: 500, createdBy: tim, addedOn: '2026-09-03' })).addedOn).toBe('2026-09-03')
  })
})
