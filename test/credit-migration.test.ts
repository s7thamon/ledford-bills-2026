import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { setDb } from '../server/db/client'
import * as schema from '../server/db/schema'
import { getBill } from '../server/services/bills'
import { listRefunds } from '../server/services/refunds'

const url = new URL(process.env.DATABASE_URL!)
url.pathname = '/ledford_bills_credit_migration_test'

/** The migrations folder as it was before running credit (0000-0003). */
function migrationsBefore0004() {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
  cpSync('server/db/migrations', dir, { recursive: true })
  const journalPath = join(dir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0004')
  writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

afterAll(() => setDb(undefined))

describe('running credit migration', () => {
  it('carries an applied credit over unchanged', async () => {
    const server = new URL(url)
    server.pathname = '/'
    const admin = await mysql.createConnection({ uri: server.toString() })
    await admin.query(`DROP DATABASE IF EXISTS \`${url.pathname.slice(1)}\``)
    await admin.query(`CREATE DATABASE \`${url.pathname.slice(1)}\``)
    await admin.end()

    const pool = mysql.createPool({ uri: url.toString(), multipleStatements: true })
    const db = drizzle(pool, { schema, mode: 'default' })
    await migrate(db, { migrationsFolder: migrationsBefore0004() })
    await pool.query(`
      INSERT INTO users (id, name, email, password) VALUES (1, 'Tim', 't@x', 'x'), (2, 'Kelly', 'k@x', 'x');
      INSERT INTO bills (id, created_by, name, amount_cents, added_on) VALUES
        (1, 1, 'Rug', 30000, '2026-10-01'), (2, 1, 'Same price', 30000, '2026-10-10'), (3, 1, 'Lamp', 4000, '2026-10-02');
      INSERT INTO bill_participants (bill_id, user_id, amount_cents, paid_at) VALUES
        (1, 1, 15000, NOW()), (1, 2, 15000, NOW()), (2, 1, 15000, NOW()), (2, 2, 15000, NOW()), (3, 1, 2000, NOW()), (3, 2, 2000, NOW());
      INSERT INTO refunds (id, bill_id, amount_cents, refunded_on, created_by, applied_to_bill_id, applied_at) VALUES
        (1, 1, 30000, '2026-10-05', 1, 2, '2026-10-10 10:00:00'), (2, 3, 4000, '2026-10-06', 1, NULL, NULL);
      INSERT INTO refund_shares (refund_id, user_id, amount_cents) VALUES (1, 1, 15000), (1, 2, 15000), (2, 1, 2000), (2, 2, 2000);
    `)
    await migrate(db, { migrationsFolder: 'server/db/migrations' })
    setDb(db)

    const bill = await getBill(2)
    expect(bill.credit).toMatchObject({ amountCents: 30000, shares: { 1: 15000, 2: 15000 } })
    expect(bill.credit!.sources).toMatchObject([{ refundId: 1, sourceName: 'Rug' }])
    expect(bill.participants.every(p => p.paidAt)).toBe(true)
    const refunds = await listRefunds()
    expect(refunds.map(r => [r.id, r.leftCents])).toEqual([[2, 4000], [1, 0]])
    await pool.end()
  })
})
