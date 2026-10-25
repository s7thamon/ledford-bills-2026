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
