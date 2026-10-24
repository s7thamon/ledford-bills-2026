import mysql from 'mysql2/promise'
import { sql } from 'drizzle-orm'
import { schema, useDb } from '../db/client'

type Row = Record<string, any>

export interface MigrationReport {
  table: string
  rows: number
  centsColumn?: string
  cents?: number
}

class DryRun extends Error {}

const CHECKS: { table: string, cents?: string }[] = [
  { table: 'users' },
  { table: 'recurring_bills', cents: 'amount_cents' },
  { table: 'recurring_bill_participants', cents: 'amount_cents' },
  { table: 'bills', cents: 'amount_cents' },
  { table: 'bill_participants', cents: 'amount_cents' },
  { table: 'reimbursements', cents: 'owed_cents' }
]

function chunk<T>(items: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Copy the Laravel database into the new schema, keeping ids. The legacy database is only read.
 * Runs in one transaction on the new database and rolls back if any row count or cent total differs.
 */
export async function migrateLegacy(legacyUrl: string, opts: { cardOwnerLegacyId?: number, dryRun?: boolean } = {}): Promise<MigrationReport[]> {
  const legacy = await mysql.createConnection({ uri: legacyUrl, dateStrings: ['DATE'] })
  try {
    await legacy.query('SET SESSION TRANSACTION READ ONLY')
    const read = async (q: string) => (await legacy.query(q))[0] as Row[]

    const db = useDb()
    const [existing] = await db.select({ n: sql<number>`count(*)` }).from(schema.users)
    if (Number(existing?.n) > 0) throw new Error('The new database already has users. Migrate into an empty database.')

    const cardOwnerId = opts.cardOwnerLegacyId ?? 2
    const [users, recurring, recurringParticipants, bills, participants, reimbursements] = await Promise.all([
      read('select * from users order by id'),
      read('select * from recurring_bills order by id'),
      read('select * from recurring_bill_participants order by id'),
      read('select * from bills order by id'),
      read('select * from bill_participants order by id'),
      read('select * from reimbursements order by id')
    ])

    const legacyTotals = new Map<string, { rows: number, cents: number }>()
    for (const check of CHECKS) {
      const [r] = await read(`select count(*) as n${check.cents ? `, coalesce(sum(${check.cents}), 0) as c` : ''} from ${check.table}`)
      legacyTotals.set(check.table, { rows: Number(r!.n), cents: Number(r!.c ?? 0) })
    }

    const report: MigrationReport[] = []
    try {
      await db.transaction(async (tx) => {
        for (const part of chunk(users)) {
          await tx.insert(schema.users).values(part.map(u => ({
            id: u.id,
            name: u.name,
            email: String(u.email).trim().toLowerCase(),
            password: u.password,
            emailVerifiedAt: u.email_verified_at,
            isCardOwner: u.id === cardOwnerId,
            createdAt: u.created_at ?? new Date(),
            updatedAt: u.updated_at ?? new Date()
          })))
        }
        for (const part of chunk(recurring)) {
          await tx.insert(schema.recurringBills).values(part.map(r => ({
            id: r.id,
            createdBy: r.created_by,
            type: r.type ?? 'bill',
            otherUserId: r.other_user_id,
            name: r.name,
            amountCents: Number(r.amount_cents),
            dayOfMonth: r.day_of_month,
            sortOrder: r.sort_order ?? 0,
            active: !!r.active,
            createdAt: r.created_at ?? new Date(),
            updatedAt: r.updated_at ?? new Date()
          })))
        }
        for (const part of chunk(recurringParticipants)) {
          await tx.insert(schema.recurringBillParticipants).values(part.map(p => ({
            id: p.id,
            recurringBillId: p.recurring_bill_id,
            userId: p.user_id,
            amountCents: Number(p.amount_cents),
            createdAt: p.created_at ?? new Date(),
            updatedAt: p.updated_at ?? new Date()
          })))
        }
        for (const part of chunk(bills)) {
          await tx.insert(schema.bills).values(part.map(b => ({
            id: b.id,
            recurringBillId: b.recurring_bill_id,
            createdBy: b.created_by,
            name: b.name,
            amountCents: Number(b.amount_cents),
            addedOn: b.added_on,
            cardPaidAt: b.card_paid_at,
            createdAt: b.created_at ?? new Date(),
            updatedAt: b.updated_at ?? new Date()
          })))
        }
        for (const part of chunk(participants)) {
          await tx.insert(schema.billParticipants).values(part.map(p => ({
            id: p.id,
            billId: p.bill_id,
            userId: p.user_id,
            amountCents: Number(p.amount_cents),
            paidAt: p.paid_at,
            createdAt: p.created_at ?? new Date(),
            updatedAt: p.updated_at ?? new Date()
          })))
        }
        for (const part of chunk(reimbursements)) {
          await tx.insert(schema.reimbursements).values(part.map(r => ({
            id: r.id,
            recurringBillId: r.recurring_bill_id,
            createdBy: r.created_by,
            otherUserId: r.other_user_id,
            name: r.name,
            owedCents: Number(r.owed_cents),
            notes: r.notes,
            transferCompletedAt: r.transfer_completed_at,
            completedAt: r.completed_at,
            createdAt: r.created_at ?? new Date(),
            updatedAt: r.updated_at ?? new Date()
          })))
        }

        for (const check of CHECKS) {
          const [[r]] = await tx.execute(sql.raw(`select count(*) as n${check.cents ? `, coalesce(sum(${check.cents}), 0) as c` : ''} from ${check.table}`)) as unknown as [Row[]]
          const actual = { rows: Number(r!.n), cents: Number(r!.c ?? 0) }
          const expected = legacyTotals.get(check.table)!
          if (actual.rows !== expected.rows || actual.cents !== expected.cents) {
            throw new Error(`${check.table} mismatch: legacy ${expected.rows} rows / ${expected.cents} cents, new ${actual.rows} rows / ${actual.cents} cents`)
          }
          report.push({ table: check.table, rows: actual.rows, centsColumn: check.cents, cents: check.cents ? actual.cents : undefined })
        }

        if (opts.dryRun) throw new DryRun()
      })
    }
    catch (e) {
      if (!(e instanceof DryRun)) throw e
    }
    return report
  }
  finally {
    await legacy.end()
  }
}
