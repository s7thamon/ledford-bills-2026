import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { migrateLegacy } from '../server/services/legacy-migration'
import { attemptLogin } from '../server/services/auth'
import { listUsers } from '../server/services/users'
import { getBill } from '../server/services/bills'
import { listRecurring } from '../server/services/recurring'
import { resetDb } from './helpers'

const LEGACY = process.env.LEGACY_TEST_DATABASE_URL!

async function seedLegacy() {
  const conn = await mysql.createConnection({ uri: LEGACY, multipleStatements: true })
  await conn.query(readFileSync('test/fixtures/legacy-schema.sql', 'utf8'))
  const hash = (await bcrypt.hash('legacy-pass-1', 4)).replace(/^\$2b\$/, '$2y$')
  await conn.query(`
    INSERT INTO users (id, name, email, password, email_verified_at, created_at, updated_at) VALUES
      (1, 'Tim Hamon', 'Tim@Example.com', '${hash}', NOW(), NOW(), NOW()),
      (2, 'Kelly Ledford', 'kelly@example.com', '${hash}', NOW(), NOW(), NOW());
    INSERT INTO recurring_bills (id, created_by, type, other_user_id, name, amount_cents, day_of_month, sort_order, active, created_at, updated_at) VALUES
      (1, 1, 'bill', NULL, 'Internet', 8000, 5, 0, 1, NOW(), NOW()),
      (2, 2, 'reimbursement', 1, 'Phone', 4000, 1, 0, 0, NOW(), NOW());
    INSERT INTO recurring_bill_participants (recurring_bill_id, user_id, amount_cents) VALUES (1, 1, 4000), (1, 2, 4000);
    INSERT INTO bills (id, recurring_bill_id, created_by, name, amount_cents, added_on, card_paid_at, created_at, updated_at) VALUES
      (10, 1, 1, 'Internet', 8000, '2026-10-05', NULL, NOW(), NOW()),
      (11, NULL, 2, 'Costco - Blanket', 2668, '2026-10-24', '2026-10-24 10:00:00', NOW(), NOW());
    INSERT INTO bill_participants (bill_id, user_id, amount_cents, paid_at) VALUES
      (10, 1, 4000, NULL), (10, 2, 4000, '2026-10-06 09:00:00'), (11, 1, 2668, NOW()), (11, 2, 0, NOW());
    INSERT INTO reimbursements (recurring_bill_id, created_by, other_user_id, name, owed_cents, notes, created_at, updated_at) VALUES
      (2, 1, 2, 'Phone', 4000, 'Oct', NOW(), NOW());
  `)
  await conn.end()
}

beforeEach(async () => {
  await resetDb()
  await seedLegacy()
})

describe('legacy migration', () => {
  it('dry run verifies without writing', async () => {
    const report = await migrateLegacy(LEGACY, { dryRun: true })
    expect(report.find(r => r.table === 'bills')).toMatchObject({ rows: 2, cents: 10668 })
    expect(await listUsers()).toHaveLength(0)
  })

  it('copies everything, keeps ids, maps the card owner, and keeps old passwords working', async () => {
    const report = await migrateLegacy(LEGACY)
    expect(report.map(r => [r.table, r.rows])).toEqual([
      ['users', 2], ['recurring_bills', 2], ['recurring_bill_participants', 2], ['bills', 2], ['bill_participants', 4], ['reimbursements', 1]
    ])
    expect((await listUsers()).find(u => u.isCardOwner)!.id).toBe(2)
    const costco = await getBill(11)
    expect(costco.addedOn).toBe('2026-10-24')
    expect(costco.participants.map(p => p.amountCents)).toEqual([2668, 0])
    expect((await listRecurring()).find(r => r.id === 2)).toMatchObject({ type: 'reimbursement', otherUserId: 1, active: false })
    expect(await attemptLogin('tim@example.com', 'legacy-pass-1')).not.toBeNull()
  })

  it('refuses to migrate into a database that already has users', async () => {
    await migrateLegacy(LEGACY)
    await expect(migrateLegacy(LEGACY)).rejects.toThrow(/already has users/)
  })
})
