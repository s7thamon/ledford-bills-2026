/** Citi CSV parsing and matching for the Reconcile page. Pure: the CSV never leaves the browser. */

export interface StatementLine {
  id: string
  status: string
  date: string
  description: string
  /** Charges are positive, credits (refunds and payments) negative. */
  amountCents: number
  kind: 'charge' | 'refund' | 'payment'
}

export interface ReconcileBill {
  id: number
  name: string
  amountCents: number
  addedOn: string
  cardPaidAt: string | null
  /** What the joint account actually paid Citi for it (after any refund credit). */
  cardDueCents: number
}

export interface ReconcileRefund { id: number, billId: number, amountCents: number, refundedOn: string }

const HEADER = ['Status', 'Date', 'Description', 'Debit', 'Credit']

function splitCsvRow(row: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    }
    else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cell); cell = '' }
    else cell += c
  }
  cells.push(cell)
  return cells.map(s => s.trim())
}

const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, '')) * 100)

export function parseCitiCsv(text: string): { lines: StatementLine[], from: string, to: string } {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(r => r.trim())
  const header = splitCsvRow(rows[0] ?? '')
  if (HEADER.some((h, i) => header[i]?.toLowerCase() !== h.toLowerCase())) {
    throw new Error('Not a Citi CSV. Expected the columns Status, Date, Description, Debit, Credit.')
  }
  const lines = rows.slice(1).map((row, i): StatementLine => {
    const [status = '', date = '', description = '', debit = '', credit = ''] = splitCsvRow(row)
    const [m, d, y] = date.split('/')
    const amountCents = debit ? Math.abs(toCents(debit)) : -Math.abs(toCents(credit))
    const kind = amountCents > 0 ? 'charge' : /^ONLINE PAYMENT/i.test(description) ? 'payment' : 'refund'
    return { id: String(i), status, date: `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`, description, amountCents, kind }
  }).filter(l => Number.isFinite(l.amountCents) && l.amountCents !== 0)
  const dates = lines.map(l => l.date).sort()
  return { lines, from: dates[0] ?? '', to: dates.at(-1) ?? '' }
}

/** Store name for grouping split charges: "AMAZON RETA* X" and "AMAZON MKTPL*Y" are both AMAZON. */
export function storeKey(description: string): string {
  const cleaned = description.toUpperCase()
    .replace(/^(WWW\s+|SPI\*|DD \*|SQ \*|TST\*\s*)/, '')
    .split(/[*#\d]/)[0]!
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  // First word is usually the store ("AMAZON", "COSTCO"); short ones need the next word ("FOOD LION").
  return (words[0] && words[0].length <= 4 ? words.slice(0, 2) : words.slice(0, 1)).join(' ')
}

export const daysApart = (a: string, b: string) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000

/** Exact-sum subset of min..max items, fewest items first. Inputs are small (a few days of one store). */
export function findSubset<T extends string | number>(items: { id: T, cents: number }[], target: number, min: number, max: number): T[] | null {
  const pool = items.slice(0, 16)
  for (let size = min; size <= Math.min(max, pool.length); size++) {
    const pick: number[] = []
    const walk = (start: number, sum: number): T[] | null => {
      if (pick.length === size) return sum === target ? pick.map(i => pool[i]!.id) : null
      for (let i = start; i < pool.length; i++) {
        pick.push(i)
        const found = walk(i + 1, sum + pool[i]!.cents)
        if (found) return found
        pick.pop()
      }
      return null
    }
    const found = walk(0, 0)
    if (found) return found
  }
  return null
}

export function matchCharges(lines: StatementLine[], bills: ReconcileBill[], refunds: ReconcileRefund[], windowDays = 5) {
  const used = new Set<string>()
  const matchedBills = new Set<number>()
  const exact: { lineIds: string[], billId: number }[] = []
  const charges = lines.filter(l => l.kind === 'charge')

  for (const b of bills) {
    const candidate = charges
      .filter(l => !used.has(l.id) && l.amountCents === b.amountCents && daysApart(l.date, b.addedOn) <= windowDays)
      .sort((x, y) => daysApart(x.date, b.addedOn) - daysApart(y.date, b.addedOn))[0]
    if (candidate) {
      used.add(candidate.id)
      matchedBills.add(b.id)
      exact.push({ lineIds: [candidate.id], billId: b.id })
    }
  }

  const usedRefunds = new Set<number>()
  const refundMatches: { lineId: string, refundId: number }[] = []
  for (const l of lines.filter(l => l.kind === 'refund')) {
    const r = refunds
      .filter(r => !usedRefunds.has(r.id) && r.amountCents === -l.amountCents && daysApart(r.refundedOn, l.date) <= windowDays)
      .sort((x, y) => daysApart(x.refundedOn, l.date) - daysApart(y.refundedOn, l.date))[0]
    if (r) {
      usedRefunds.add(r.id)
      used.add(l.id)
      refundMatches.push({ lineId: l.id, refundId: r.id })
    }
  }

  const suggestions: { lineIds: string[], billId: number }[] = []
  for (const b of bills.filter(b => !matchedBills.has(b.id))) {
    const near = charges.filter(l => !used.has(l.id) && daysApart(l.date, b.addedOn) <= windowDays)
    const byStore = new Map<string, StatementLine[]>()
    for (const l of near) byStore.set(storeKey(l.description), [...(byStore.get(storeKey(l.description)) ?? []), l])
    for (const group of byStore.values()) {
      const ids = findSubset(group.map(l => ({ id: l.id, cents: l.amountCents })), b.amountCents, 2, 4)
      if (ids) {
        ids.forEach(id => used.add(id))
        matchedBills.add(b.id)
        suggestions.push({ lineIds: ids, billId: b.id })
        break
      }
    }
  }

  return {
    exact,
    refunds: refundMatches,
    suggestions,
    leftoverLines: lines.filter(l => l.kind !== 'payment' && !used.has(l.id)).map(l => l.id),
    leftoverBills: bills.filter(b => !matchedBills.has(b.id)).map(b => b.id)
  }
}

export function matchPayments(lines: StatementLine[], bills: ReconcileBill[], windowDays = 5) {
  const payments = lines.filter(l => l.kind === 'payment')
  const paid = bills.filter(b => b.cardPaidAt)
  const usedBills = new Set<number>()
  const usedLines = new Set<string>()
  const exact: { lineId: string, billIds: number[] }[] = []
  for (const p of payments) {
    const b = paid
      .filter(b => !usedBills.has(b.id) && b.cardDueCents === -p.amountCents && daysApart(b.cardPaidAt!, p.date) <= windowDays)
      .sort((x, y) => daysApart(x.cardPaidAt!, p.date) - daysApart(y.cardPaidAt!, p.date))[0]
    if (b) {
      usedBills.add(b.id)
      usedLines.add(p.id)
      exact.push({ lineId: p.id, billIds: [b.id] })
    }
  }
  const suggestions: { lineId: string, billIds: number[] }[] = []
  for (const p of payments.filter(p => !usedLines.has(p.id))) {
    const near = paid.filter(b => !usedBills.has(b.id) && daysApart(b.cardPaidAt!, p.date) <= windowDays)
    const ids = findSubset(near.map(b => ({ id: b.id, cents: b.cardDueCents })), -p.amountCents, 2, 6)
    if (ids) {
      ids.forEach(id => usedBills.add(id))
      usedLines.add(p.id)
      suggestions.push({ lineId: p.id, billIds: ids })
    }
  }
  return {
    exact,
    suggestions,
    leftoverLines: payments.filter(p => !usedLines.has(p.id)).map(p => p.id),
    leftoverBills: paid.filter(b => !usedBills.has(b.id)).map(b => b.id)
  }
}
