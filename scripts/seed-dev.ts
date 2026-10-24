/**
 * Local demo data for this month and last month.
 *   npm run db:seed
 * Skips if bills already exist. Pass --force to add another copy.
 */
import { eq, sql } from 'drizzle-orm'
import { schema, useDb } from '../server/db/client'
import { createUser, findUserByEmail } from '../server/services/auth'
import { currentMonth, shiftMonth } from '../shared/utils/dates'
import { splitAmounts } from '../shared/utils/split'

const force = process.argv.includes('--force')
const password = process.env.USER_PASSWORD || 'DevPassword123'
const db = useDb()

async function user(name: string, email: string) {
  const existing = await findUserByEmail(email)
  if (existing) return existing.id
  return createUser({ name, email, password })
}

const tim = await user('Tim Hamon', 'tim@example.com')
const kelly = await user('Kelly Ledford', 'kelly@example.com')
await db.update(schema.users).set({ isCardOwner: false })
await db.update(schema.users).set({ isCardOwner: true }).where(eq(schema.users.id, kelly))

const [{ n: billCount }] = await db.select({ n: sql<number>`count(*)` }).from(schema.bills)
if (Number(billCount) > 0 && !force) {
  console.log('Bills already exist. Re-run with --force to add another demo set.')
  process.exit(0)
}

const thisMonth = currentMonth()
const lastMonth = shiftMonth(thisMonth, -1)
const ids = [tim, kelly]
const paid = (when: string) => new Date(`${when}T16:00:00`)

async function bill(opts: {
  name: string
  cents: number
  on: string
  splits?: Record<number, number>
  paidBy?: number[]
  cardPaid?: boolean
}) {
  const amounts = opts.splits ?? splitAmounts(opts.cents, ids)
  const [res] = await db.insert(schema.bills).values({
    name: opts.name,
    amountCents: opts.cents,
    createdBy: tim,
    addedOn: opts.on,
    cardPaidAt: opts.cardPaid ? paid(opts.on) : null
  })
  await db.insert(schema.billParticipants).values(ids.map(userId => ({
    billId: res.insertId,
    userId,
    amountCents: amounts[userId] ?? 0,
    paidAt: opts.paidBy?.includes(userId) ? paid(opts.on) : null
  })))
}

async function recurring(opts: {
  name: string
  cents: number
  day: number
  type?: 'bill' | 'reimbursement'
  otherUserId?: number
  splits?: Record<number, number>
  active?: boolean
}) {
  const [res] = await db.insert(schema.recurringBills).values({
    createdBy: tim,
    type: opts.type ?? 'bill',
    otherUserId: opts.otherUserId ?? null,
    name: opts.name,
    amountCents: opts.cents,
    dayOfMonth: opts.day,
    sortOrder: 0,
    active: opts.active ?? true
  })
  if ((opts.type ?? 'bill') === 'bill') {
    const amounts = opts.splits ?? splitAmounts(opts.cents, ids)
    await db.insert(schema.recurringBillParticipants).values(ids.map(userId => ({
      recurringBillId: res.insertId,
      userId,
      amountCents: amounts[userId] ?? 0
    })))
  }
}

await Promise.all([
  bill({ name: 'Food Lion', cents: 4765, on: `${thisMonth}-03` }),
  bill({ name: 'Duke Energy', cents: 14218, on: `${thisMonth}-05`, paidBy: [tim] }),
  bill({ name: 'Spectrum', cents: 7999, on: `${thisMonth}-08`, paidBy: [tim, kelly] }),
  bill({ name: 'Costco', cents: 23410, on: `${thisMonth}-12`, splits: { [tim]: 15000, [kelly]: 8410 } }),
  bill({ name: 'Netflix', cents: 1549, on: `${thisMonth}-15`, paidBy: [tim, kelly], cardPaid: true }),
  bill({ name: 'City Water', cents: 3800, on: `${thisMonth}-18`, paidBy: [kelly] }),
  bill({ name: 'Rent', cents: 180000, on: `${lastMonth}-01`, paidBy: [tim, kelly], cardPaid: true }),
  bill({ name: 'Harris Teeter', cents: 8920, on: `${lastMonth}-09` }),
  bill({ name: 'Shell', cents: 5433, on: `${lastMonth}-14`, paidBy: [tim, kelly] }),
  bill({ name: 'CVS', cents: 2215, on: `${lastMonth}-22`, splits: { [tim]: 500, [kelly]: 1715 }, paidBy: [tim, kelly], cardPaid: true })
])

const [{ n: recurringCount }] = await db.select({ n: sql<number>`count(*)` }).from(schema.recurringBills)
if (Number(recurringCount) === 0 || force) {
  await recurring({ name: 'Rent', cents: 180000, day: 1 })
  await recurring({ name: 'Spectrum', cents: 7999, day: 5 })
  await recurring({ name: 'Netflix', cents: 1549, day: 12, active: false })
  await recurring({ name: 'Car insurance', cents: 12500, day: 15, type: 'reimbursement', otherUserId: kelly })
}

const [{ n: reimburseCount }] = await db.select({ n: sql<number>`count(*)` }).from(schema.reimbursements)
if (Number(reimburseCount) === 0 || force) {
  await db.insert(schema.reimbursements).values([
    { name: 'Concert tickets', owedCents: 8600, createdBy: tim, otherUserId: kelly, notes: 'Kelly said she would Venmo this.' },
    { name: 'Vet bill', owedCents: 14250, createdBy: tim, otherUserId: kelly, transferCompletedAt: paid(`${thisMonth}-10`) },
    { name: 'IKEA shelves', owedCents: 5400, createdBy: tim, otherUserId: kelly, transferCompletedAt: paid(`${lastMonth}-18`), completedAt: paid(`${lastMonth}-19`) },
    { name: 'Airport parking', owedCents: 2800, createdBy: kelly, otherUserId: tim }
  ])
}

console.log(`Seeded demo bills for ${lastMonth} and ${thisMonth}. Sign in as tim@example.com or kelly@example.com / ${password}`)
process.exit(0)
