import { canMarkCardPaid, type BillLike } from './rules'
import { cardDue } from './credits'

export type BillTab = 'all' | 'mine' | 'theirs' | 'card' | 'ready'
export const BILL_TABS: BillTab[] = ['all', 'mine', 'theirs', 'card', 'ready']

export const isBillTab = (v: unknown): v is BillTab => BILL_TABS.includes(v as BillTab)

export function billInTab(bill: BillLike, tab: BillTab, userId: number): boolean {
  if (tab === 'mine') return bill.participants.some(p => p.userId === userId && !p.paidAt)
  if (tab === 'theirs') return bill.participants.some(p => p.userId !== userId && !p.paidAt)
  if (tab === 'card') return !bill.cardPaidAt && !bill.paidWithCardOf
  if (tab === 'ready') return canMarkCardPaid(bill)
  return true
}

export function tabCounts(bills: BillLike[], userId: number): Record<BillTab, number> {
  return Object.fromEntries(BILL_TABS.map(tab => [tab, bills.filter(b => billInTab(b, tab, userId)).length])) as Record<BillTab, number>
}

export const readyForCardCents = (bills: BillLike[]) =>
  bills.reduce((sum, b) => sum + (canMarkCardPaid(b) ? cardDue(b) : 0), 0)

/** What the joint account still has to pay Citi: skips card-paid and different-card bills, net of credits. */
export const cardUnpaidCents = (bills: BillLike[]) =>
  bills.reduce((sum, b) => sum + (b.cardPaidAt || b.paidWithCardOf ? 0 : cardDue(b)), 0)

/** Case-insensitive substring match that keeps the server's most-used-first order. */
export function filterSuggestions(names: string[], query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase()
  return names.filter(n => n.toLowerCase().includes(q)).slice(0, limit)
}
