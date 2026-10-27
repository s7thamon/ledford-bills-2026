import { describe, expect, it } from 'vitest'
import { daysBetweenVisits, monthlyTotals, rangeMonths, storeTotals } from '../shared/utils/insights'

const b = (id: number, name: string, amountCents: number, addedOn: string) => ({ id, name, amountCents, addedOn })

describe('insights', () => {
  it('works out ranges and the period before', () => {
    expect(rangeMonths('3m', '2026-10')).toMatchObject({ from: '2026-08', to: '2026-10', prevFrom: '2026-05', prevTo: '2026-07' })
    expect(rangeMonths('ytd', '2026-10')).toMatchObject({ from: '2026-01', to: '2026-10', prevFrom: '2025-03', prevTo: '2025-12' })
    expect(rangeMonths('lastyear', '2026-10')).toMatchObject({ from: '2025-01', to: '2025-12', prevFrom: '2024-01', prevTo: '2024-12' })
  })

  it('groups store names loosely and keeps the variants', () => {
    const [costco, foodLion] = storeTotals([
      b(1, 'Costco - Blanket', 2680, '2026-10-24'),
      b(2, 'Costco - Meds', 5000, '2026-10-02'),
      b(3, 'costco', 1000, '2026-09-02'),
      b(6, 'Costco Oil', 500, '2026-09-03'),
      b(4, 'Food Lion', 3000, '2026-10-01'),
      b(5, 'foodlion', 1000, '2026-10-08')
    ])
    expect(costco).toMatchObject({ key: 'costco', cents: 9180, visits: 4 })
    expect(costco!.variants.map(v => v.name)).toEqual(['Costco - Meds', 'Costco - Blanket', 'costco', 'Costco Oil'])
    expect(foodLion).toMatchObject({ key: 'foodlion', label: 'Food Lion', cents: 4000, visits: 2 })
  })

  it('totals months, including empty ones, and spacing between visits', () => {
    const bills = [b(1, 'A', 100, '2026-08-01'), b(2, 'A', 200, '2026-08-11'), b(3, 'A', 300, '2026-10-01')]
    expect(monthlyTotals(bills, ['2026-08', '2026-09', '2026-10']).map(m => m.cents)).toEqual([300, 0, 300])
    expect(daysBetweenVisits(bills)).toBe(31)
    expect(daysBetweenVisits([bills[0]!])).toBeNull()
  })
})
