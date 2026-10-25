import { canMarkCardPaid, type BillLike } from './rules'

export type BillTab = 'all' | 'mine' | 'card' | 'ready'
export const BILL_TABS: BillTab[] = ['all', 'mine', 'card', 'ready']

export const isBillTab = (v: unknown): v is BillTab => BILL_TABS.includes(v as BillTab)

export function billInTab(bill: BillLike, tab: BillTab, userId: number): boolean {
  if (tab === 'mine') return bill.participants.some(p => p.userId === userId && !p.paidAt)
  if (tab === 'card') return !bill.cardPaidAt
  if (tab === 'ready') return canMarkCardPaid(bill)
  return true
}

export function tabCounts(bills: BillLike[], userId: number): Record<BillTab, number> {
  return Object.fromEntries(BILL_TABS.map(tab => [tab, bills.filter(b => billInTab(b, tab, userId)).length])) as Record<BillTab, number>
}

export const readyForCardCents = (bills: BillLike[]) =>
  bills.reduce((sum, b) => sum + (canMarkCardPaid(b) ? b.amountCents : 0), 0)

/** Case-insensitive substring match that keeps the server's most-used-first order. */
export function filterSuggestions(names: string[], query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase()
  return names.filter(n => n.toLowerCase().includes(q)).slice(0, limit)
}
