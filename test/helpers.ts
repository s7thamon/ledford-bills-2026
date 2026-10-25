import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { useDb } from '../server/db/client'
import { createUser } from '../server/services/auth'
import { sentMail } from '../server/utils/mail'
import { clearRateLimits } from '../server/utils/rate-limit'

const TABLES = ['refund_shares', 'refunds', 'auth_tokens', 'trusted_devices', 'bill_participants', 'bills', 'reimbursements', 'recurring_bill_participants', 'recurring_bills', 'users']

let migrated = false

/** Fresh tables plus Tim (#1) and Kelly (#2, card owner). */
export async function resetDb() {
  const db = useDb()
  if (!migrated) {
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
    for (const t of [...TABLES, '__drizzle_migrations']) await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${t}\``))
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
    await migrate(db, { migrationsFolder: 'server/db/migrations' })
    migrated = true
  }
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
  for (const t of TABLES) await db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``))
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
  sentMail.length = 0
  clearRateLimits()
}

export const PASSWORD = 'CorrectHorse42'

export async function seedUsers() {
  const tim = await createUser({ name: 'Tim Hamon', email: 'tim@example.com', password: PASSWORD })
  const kelly = await createUser({ name: 'Kelly Ledford', email: 'kelly@example.com', password: PASSWORD })
  await useDb().execute(sql`UPDATE users SET is_card_owner = 1 WHERE id = ${kelly}`)
  return { tim, kelly }
}

/** Notifications are fire-and-forget; let queued sends land. */
export const flushMail = () => new Promise(r => setTimeout(r, 10))

export async function expectHttpError(promise: Promise<unknown>, statusCode: number) {
  try {
    await promise
  }
  catch (e) {
    const code = (e as { statusCode?: number }).statusCode
    if (code !== statusCode) throw new Error(`Expected HTTP ${statusCode}, got ${code}: ${(e as Error).message}`)
    return
  }
  throw new Error(`Expected HTTP ${statusCode}, but the call succeeded`)
}
