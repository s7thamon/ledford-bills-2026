import { beforeEach, describe, expect, it } from 'vitest'
import { createRecurring, generateRecurring, listRecurring, moveRecurring, setRecurringActive, updateRecurring } from '../server/services/recurring'
import { listBills } from '../server/services/bills'
import { listReimbursements } from '../server/services/reimbursements'
import { resetDb, seedUsers } from './helpers'

let tim: number, kelly: number

beforeEach(async () => {
  await resetDb()
  ;({ tim, kelly } = await seedUsers())
})

const bill = (name: string, dayOfMonth: number, amountCents = 1001) => ({ type: 'bill' as const, name, amountCents, dayOfMonth })

describe('recurring', () => {
  it('generates once per month with template splits', async () => {
    const t = await createRecurring(bill('Internet', 5), tim)
    expect(t.participants.map(p => p.amountCents)).toEqual([501, 501])
    await updateRecurring(t.id, { ...bill('Internet', 5), splits: { [tim]: 1001, [kelly]: 0 } })

    expect(await generateRecurring('2026-10-04')).toBe(0)
    expect(await generateRecurring('2026-10-05')).toBe(1)
    expect(await generateRecurring('2026-10-05')).toBe(0)
    const [generated] = await listBills({ month: '2026-10', userId: tim })
    expect(generated!.recurringBillId).toBe(t.id)
    expect(generated!.participants.find(p => p.userId === tim)!.amountCents).toBe(1001)
  })

  it('runs day 31 templates on the last day of short months', async () => {
    await createRecurring(bill('Rent', 31), tim)
    expect(await generateRecurring('2026-02-27')).toBe(0)
    expect(await generateRecurring('2026-02-28')).toBe(1)
  })

  it('skips paused templates', async () => {
    const t = await createRecurring(bill('Gym', 3), tim)
    await setRecurringActive(t.id, false)
    expect(await generateRecurring('2026-10-03')).toBe(0)
  })

  it('creates recurring reimbursements owed by the chosen user', async () => {
    await createRecurring({ type: 'reimbursement', name: 'Phone', amountCents: 4000, dayOfMonth: 1, otherUserId: kelly }, kelly)
    expect(await generateRecurring('2026-10-01')).toBe(1)
    expect(await generateRecurring('2026-10-01')).toBe(0)
    const { items } = await listReimbursements({ resolved: false, page: 1, sort: 'createdAt', dir: 'desc' })
    expect(items[0]).toMatchObject({ name: 'Phone', createdBy: tim, otherUserId: kelly, owedCents: 4000 })
  })

  it('reorders within a day', async () => {
    const a = await createRecurring(bill('A', 1), tim)
    const b = await createRecurring(bill('B', 1), tim)
    expect((await listRecurring()).map(r => r.name)).toEqual(['B', 'A'])
    await moveRecurring(b.id, 1)
    expect((await listRecurring()).map(r => r.name)).toEqual(['A', 'B'])
    await moveRecurring(a.id, -1)
    expect((await listRecurring()).map(r => r.name)).toEqual(['A', 'B'])
  })
})
