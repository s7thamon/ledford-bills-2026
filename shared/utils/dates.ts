export const APP_TIMEZONE = 'America/New_York'

/** YYYY-MM-DD for "now" in the household's timezone. */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function currentMonth(now = new Date()): string {
  return todayIso(now).slice(0, 7)
}

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

/** First and last day (inclusive) of a YYYY-MM month. */
export function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`]
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** 2026-10-24 -> 2026.10.24, matching the old table format. */
export function dotDate(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '.')
}
