import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from './schema'

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const pool = mysql.createPool({ uri: url, connectionLimit: 10, dateStrings: false })
  return drizzle(pool, { schema, mode: 'default' })
}

export type Db = ReturnType<typeof connect>

let db: Db | undefined

export function useDb(): Db {
  db ??= connect()
  return db
}

/** Tests point the app at a different database between suites. */
export function setDb(next: Db | undefined) {
  db = next
}

export { schema }
