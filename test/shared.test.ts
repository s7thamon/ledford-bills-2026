import { describe, expect, it } from 'vitest'
import { formatMoney, moneyNumber, parseAmount } from '../shared/utils/money'
import { equalShare, isCustomSplit, splitAmounts } from '../shared/utils/split'
import { daysInMonth, monthRange, ordinalDay, shiftMonth, todayIso, usDotDate } from '../shared/utils/dates'
import { canDeleteBill, canEditBill, canMarkCardPaid, canMarkTransferComplete, canMarkReimbursementComplete, reimbursementStatus } from '../shared/utils/rules'
import { billInTab, filterSuggestions, isBillTab, readyForCardCents, tabCounts } from '../shared/utils/bill-view'
import { canAbsorb, cardDue, shareDue, splitRefund } from '../shared/utils/credits'
import { cardUnpaidCents } from '../shared/utils/bill-view'

describe('different card and credits in rules', () => {
  const p = (userId: number, paid: boolean) => ({ userId, amountCents: 500, paidAt: paid ? '2026-10-01' : null })
  const personal = { amountCents: 1000, cardPaidAt: null, paidWithCardOf: 1, participants: [p(1, true), p(2, true)] }
  const credited = { amountCents: 32000, cardPaidAt: null, credit: { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }, participants: [p(1, true), p(2, true)] }
  it('never offers the card for a different-card bill', () => {
    expect(canMarkCardPaid(personal)).toBe(false)
    expect(billInTab(personal, 'ready', 1)).toBe(false)
    expect(billInTab(personal, 'card', 1)).toBe(false)
    expect(cardUnpaidCents([personal])).toBe(0)
  })
  it('uses the reduced card amount for credited bills', () => {
    expect(readyForCardCents([credited])).toBe(2000)
    expect(cardUnpaidCents([credited])).toBe(2000)
  })
})

describe('credits', () => {
  const even = [{ userId: 1, amountCents: 15000 }, { userId: 2, amountCents: 15000 }]
  it('splits a refund in proportion to stored shares, exactly', () => {
    expect(splitRefund(30000, even)).toEqual({ 1: 15000, 2: 15000 })
    expect(splitRefund(301, even)).toEqual({ 1: 151, 2: 150 })
    expect(splitRefund(1000, [{ userId: 1, amountCents: 2668 }, { userId: 2, amountCents: 0 }])).toEqual({ 1: 1000, 2: 0 })
    expect(splitRefund(1000, [{ userId: 1, amountCents: 7500 }, { userId: 2, amountCents: 2500 }])).toEqual({ 1: 750, 2: 250 })
    expect(splitRefund(101, [{ userId: 1, amountCents: 0 }, { userId: 2, amountCents: 0 }])).toEqual({ 1: 51, 2: 50 })
    const odd = splitRefund(1001, [{ userId: 1, amountCents: 3334 }, { userId: 2, amountCents: 6667 }])
    expect(odd[1]! + odd[2]!).toBe(1001)
  })
  it('checks a bill can absorb a credit', () => {
    const credit = { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }
    expect(canAbsorb({ amountCents: 32000, participants: [{ userId: 1, amountCents: 16000 }, { userId: 2, amountCents: 16000 }] }, credit)).toBe(true)
    expect(canAbsorb({ amountCents: 32000, participants: [{ userId: 1, amountCents: 32000 }, { userId: 2, amountCents: 0 }] }, credit)).toBe(false)
    expect(canAbsorb({ amountCents: 29999, participants: [{ userId: 1, amountCents: 15000 }, { userId: 2, amountCents: 15000 }] }, credit)).toBe(false)
  })
  it('computes amounts due after a credit', () => {
    const credit = { amountCents: 30000, shares: { 1: 15000, 2: 15000 } }
    expect(shareDue({ userId: 1, amountCents: 16000 }, credit)).toBe(1000)
    expect(shareDue({ userId: 1, amountCents: 16000 }, null)).toBe(16000)
    expect(cardDue({ amountCents: 32000, credit })).toBe(2000)
    expect(cardDue({ amountCents: 32000 })).toBe(32000)
  })
})

describe('money', () => {
  it('parses messy input to cents', () => {
    expect(parseAmount('$1,234.56')).toBe(123456)
    expect(parseAmount('10')).toBe(1000)
    expect(parseAmount('10.5')).toBe(1050)
    expect(parseAmount('1.005')).toBe(101)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('.99')).toBe(99)
  })
  it('formats cents', () => {
    expect(formatMoney(342414)).toBe('$3,424.14')
    expect(moneyNumber(2382)).toBe('23.82')
  })
})

describe('split', () => {
  it('rounds equal shares up', () => {
    expect(equalShare(2359, 2)).toBe(1180)
    expect(equalShare(4764, 2)).toBe(2382)
    expect(equalShare(100, 0)).toBe(0)
    expect(splitAmounts(1001, [1, 2, 3])).toEqual({ 1: 334, 2: 334, 3: 334 })
  })
  it('locks one user and rounds the rest up', () => {
    expect(splitAmounts(1000, [1, 2], { userId: 1, amountCents: 300 })).toEqual({ 1: 300, 2: 700 })
    expect(splitAmounts(1000, [1, 2, 3], { userId: 1, amountCents: 1 })).toEqual({ 1: 1, 2: 500, 3: 500 })
    expect(splitAmounts(1000, [1, 2], { userId: 2, amountCents: 5000 })).toEqual({ 1: 0, 2: 1000 })
  })
  it('detects custom splits', () => {
    expect(isCustomSplit([500, 500])).toBe(false)
    expect(isCustomSplit([0, 2668])).toBe(true)
  })
})

describe('dates', () => {
  it('handles month math', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(monthRange('2026-04')).toEqual(['2026-04-01', '2026-04-30'])
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('uses New York time for today', () => {
    expect(todayIso(new Date('2026-10-25T02:00:00Z'))).toBe('2026-10-24')
  })
})

describe('rules', () => {
  const unpaid = { amountCents: 100, cardPaidAt: null, participants: [{ userId: 1, amountCents: 50, paidAt: null }, { userId: 2, amountCents: 50, paidAt: null }] }
  const halfPaid = { ...unpaid, participants: [{ userId: 1, amountCents: 50, paidAt: new Date() }, { userId: 2, amountCents: 50, paidAt: null }] }
  const allPaid = { ...unpaid, participants: unpaid.participants.map(p => ({ ...p, paidAt: new Date() })) }

  it('locks editing once anyone paid', () => {
    expect(canEditBill(unpaid)).toBe(true)
    expect(canEditBill(halfPaid)).toBe(false)
    expect(canDeleteBill(halfPaid)).toBe(false)
  })
  it('allows card payment only when everyone paid', () => {
    expect(canMarkCardPaid(halfPaid)).toBe(false)
    expect(canMarkCardPaid(allPaid)).toBe(true)
    expect(canMarkCardPaid({ ...allPaid, cardPaidAt: new Date() })).toBe(false)
  })
  it('walks reimbursements through their states', () => {
    const r = { createdBy: 1, otherUserId: 2, transferCompletedAt: null, completedAt: null }
    expect(reimbursementStatus(r)).toBe('awaiting')
    expect(canMarkTransferComplete(r, 1)).toBe(false)
    expect(canMarkTransferComplete(r, 2)).toBe(true)
    const sent = { ...r, transferCompletedAt: new Date() }
    expect(reimbursementStatus(sent)).toBe('sent')
    expect(canMarkReimbursementComplete(sent, 2)).toBe(false)
    expect(canMarkReimbursementComplete(sent, 1)).toBe(true)
  })
})

describe('bill view', () => {
  const p = (userId: number, paid: boolean) => ({ userId, amountCents: 500, paidAt: paid ? '2026-10-01' : null })
  const bills = [
    { amountCents: 1000, cardPaidAt: null, participants: [p(1, false), p(2, true)] },
    { amountCents: 2000, cardPaidAt: null, participants: [p(1, true), p(2, true)] },
    { amountCents: 3000, cardPaidAt: '2026-10-02', participants: [p(1, true), p(2, true)] }
  ]
  it('counts tabs', () => {
    expect(tabCounts(bills, 1)).toEqual({ all: 3, mine: 1, theirs: 0, card: 2, ready: 1 })
    expect(tabCounts(bills, 2)).toEqual({ all: 3, mine: 0, theirs: 1, card: 2, ready: 1 })
    expect(tabCounts([], 1)).toEqual({ all: 0, mine: 0, theirs: 0, card: 0, ready: 0 })
  })
  it('filters by tab', () => {
    expect(bills.filter(b => billInTab(b, 'ready', 1))).toEqual([bills[1]])
    expect(bills.filter(b => billInTab(b, 'theirs', 2))).toEqual([bills[0]])
    expect(isBillTab('ready')).toBe(true)
    expect(isBillTab('theirs')).toBe(true)
    expect(isBillTab('nope')).toBe(false)
  })
  it('sums ready-for-card', () => {
    expect(readyForCardCents(bills)).toBe(2000)
  })
  it('filters suggestions keeping order', () => {
    const names = ['Rent', 'Food Lion', 'Current', 'Netflix']
    expect(filterSuggestions(names, 'ren')).toEqual(['Rent', 'Current'])
    expect(filterSuggestions(names, '  FOOD ')).toEqual(['Food Lion'])
    expect(filterSuggestions(names, '')).toEqual(names)
    expect(filterSuggestions(Array.from({ length: 15 }, (_, i) => `n${i}`), 'n')).toHaveLength(10)
    expect(filterSuggestions(names, 'zzz')).toEqual([])
  })
})

describe('day labels', () => {
  it('ordinal day of month', () => {
    expect(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-31'].map(ordinalDay))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '24th', '31st'])
  })
  it('US dotted date', () => {
    expect(usDotDate('2026-10-03')).toBe('10.03.2026')
  })
})
