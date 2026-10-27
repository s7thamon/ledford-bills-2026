/** Spending reports for the Insights and Search pages. Pure, so both pages and tests share it. */
import { currentMonth, shiftMonth } from './dates'

export interface InsightBill { id: number, name: string, amountCents: number, addedOn: string }

export const INSIGHT_RANGES = [
  { value: '3m', label: '3 Months' },
  { value: '6m', label: '6 Months' },
  { value: '12m', label: '12 Months' },
  { value: 'ytd', label: 'This Year' },
  { value: 'lastyear', label: 'Last Year' }
] as const
export type InsightRange = typeof INSIGHT_RANGES[number]['value']
export const isInsightRange = (v: unknown): v is InsightRange => INSIGHT_RANGES.some(r => r.value === v)

/** First and last month (YYYY-MM, inclusive) of a range, and the same-length period just before it. */
export function rangeMonths(range: InsightRange, now = currentMonth()) {
  const year = Number(now.slice(0, 4))
  const [from, to] = range === 'ytd'
    ? [`${year}-01`, now]
    : range === 'lastyear'
      ? [`${year - 1}-01`, `${year - 1}-12`]
      : [shiftMonth(now, -(Number.parseInt(range) - 1)), now]
  const months = monthsBetween(from, to)
  return { from, to, months, prevFrom: shiftMonth(from, -months.length), prevTo: shiftMonth(from, -1) }
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m)
  return out
}

/**
 * Grouping key for a store: the part before " - ", ignoring case, spaces and punctuation.
 * "Costco - Blanket", "Costco - Meds" and "costco" are one store; so are "Food Lion" and "foodlion".
 */
export const storeOf = (name: string) => name.split(' - ')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Text typed into search, reduced the same way, so "foodlion" finds "Food Lion". */
export const searchKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface StoreTotal { key: string, label: string, cents: number, visits: number, variants: { name: string, cents: number, visits: number }[] }

export function storeTotals(bills: InsightBill[]): StoreTotal[] {
  // Older names have no " - " ("Costco Oil"), so a key starting with another store's key joins that store.
  const keys = [...new Set(bills.map(b => storeOf(b.name)))].sort((a, b) => a.length - b.length)
  const canonical = new Map(keys.map(k => [k, keys.find(p => p.length >= 4 && k.startsWith(p)) ?? k]))
  const stores = new Map<string, InsightBill[]>()
  for (const b of bills) {
    const key = canonical.get(storeOf(b.name))!
    stores.set(key, [...(stores.get(key) ?? []), b])
  }
  return [...stores].map(([key, list]) => {
    const byName = new Map<string, { name: string, cents: number, visits: number }>()
    for (const b of list) {
      const v = byName.get(b.name) ?? { name: b.name, cents: 0, visits: 0 }
      byName.set(b.name, { ...v, cents: v.cents + b.amountCents, visits: v.visits + 1 })
    }
    const variants = [...byName.values()].sort((a, b) => b.cents - a.cents)
    // The spelling used most often names the store.
    const label = [...variants].sort((a, b) => b.visits - a.visits)[0]!.name.split(' - ')[0]!
    return { key, label, cents: list.reduce((s, b) => s + b.amountCents, 0), visits: list.length, variants }
  }).sort((a, b) => b.cents - a.cents)
}

export function monthlyTotals(bills: InsightBill[], months: string[]) {
  const totals = Object.fromEntries(months.map(m => [m, 0]))
  for (const b of bills) {
    const m = b.addedOn.slice(0, 7)
    if (m in totals) totals[m]! += b.amountCents
  }
  return months.map(m => ({ month: m, cents: totals[m]! }))
}

/** Average days between visits, or null with fewer than two. */
export function daysBetweenVisits(bills: InsightBill[]): number | null {
  const days = [...new Set(bills.map(b => b.addedOn))].sort()
  if (days.length < 2) return null
  return Math.round((Date.parse(days.at(-1)!) - Date.parse(days[0]!)) / 86_400_000 / (days.length - 1))
}
