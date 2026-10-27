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

/** Words of the store part of a name: before " - ", lowercased, apostrophes and plural s dropped ("Lowe's", "Subs"). */
const wordsOf = (name: string) => name.split(/\s+[-–—]\s+/)[0]!.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
  .map(w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/**
 * Store key for every bill name, worked out from all the names together:
 * - names pool under their shared leading words ("Amazon Prime", "Amazon (Sheets)" are Amazon),
 * - the same words in another order are one name ("Internet-Spectrum", "Spectrum Internet"),
 * - a sub-group with 3+ bills stays its own store when it is a third of its parent or outnumbers bills named just the parent
 *   ("Lowes Foods" apart from "Lowe's Mulch", "Water Filter" apart from "Water"),
 * - a fragment that is never a whole name doesn't pool ("The Pond Guy" stays apart from other "The ..." stores),
 * - keys a letter or two apart merge, for plurals and possessives ("Jersey Mike", "Jersey Mikes").
 */
export function storeKeys(names: string[]): Map<string, string> {
  const words = new Map(names.map(n => [n, wordsOf(n)]))
  // Same words in any order take the most common order.
  const orders = new Map<string, Map<string, number>>()
  for (const n of names) {
    const w = words.get(n)!
    const sig = [...w].sort().join(' ')
    const seen = orders.get(sig) ?? new Map<string, number>()
    seen.set(w.join(' '), (seen.get(w.join(' ')) ?? 0) + 1)
    orders.set(sig, seen)
  }
  for (const [n, w] of words) {
    const best = [...orders.get([...w].sort().join(' '))!].sort((a, b) => b[1] - a[1])[0]![0]
    words.set(n, best ? best.split(' ') : [])
  }
  const prefix = (w: string[], k: number) => w.slice(0, k).join('')
  const counts = new Map<string, number>()
  for (const w of names.map(n => words.get(n)!)) {
    for (let k = 1; k <= w.length; k++) counts.set(prefix(w, k), (counts.get(prefix(w, k)) ?? 0) + 1)
  }
  const exact = new Map<string, number>()
  for (const n of names) exact.set(words.get(n)!.join(''), (exact.get(words.get(n)!.join('')) ?? 0) + 1)
  const keyOf = new Map<string, string>()
  for (const [name, w] of words) {
    if (!w.length) {
      keyOf.set(name, name.toLowerCase())
      continue
    }
    let k = 1
    while (k < w.length) {
      const next = counts.get(prefix(w, k + 1))!
      if (next >= 3 && (next * 3 >= counts.get(prefix(w, k))! || next >= (exact.get(prefix(w, k)) ?? 0))) k++
      else break
    }
    keyOf.set(name, k < w.length && !exact.has(prefix(w, k)) ? w.join('') : prefix(w, k))
  }
  const keys = [...new Set(keyOf.values())].sort((a, b) => a.length - b.length)
  const merged = new Map(keys.map(k => [k, keys.find(p => p.length >= 4 && k !== p && k.startsWith(p) && k.length - p.length <= 2) ?? k]))
  return new Map([...keyOf].map(([name, key]) => [name, merged.get(key)!]))
}

/** Text typed into search, reduced the same way, so "foodlion" finds "Food Lion". */
export const searchKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface StoreTotal { key: string, label: string, cents: number, visits: number, variants: { name: string, cents: number, visits: number }[] }

export function storeTotals(bills: InsightBill[]): StoreTotal[] {
  const keyOf = storeKeys(bills.map(b => b.name))
  const stores = new Map<string, InsightBill[]>()
  for (const b of bills) {
    const key = keyOf.get(b.name)!
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
