/** Parses "$1,234.567" style input into integer cents without float drift (half up on the third decimal). */
export function parseAmount(input: string | number | null | undefined): number {
  const clean = String(input ?? '').replace(/[^\d.]/g, '')
  if (!clean) return 0
  const [whole = '', frac = ''] = clean.split('.')
  const cents = Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2))
  return cents + (Number(frac[2] ?? 0) >= 5 ? 1 : 0)
}

export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Plain "1234.56" for copying into a banking app. */
export function moneyNumber(cents: number): string {
  return (cents / 100).toFixed(2)
}
