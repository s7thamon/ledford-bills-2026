import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import bcrypt from 'bcryptjs'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>
const PARAMS = { N: 16384, r: 8, p: 1 }

export async function hashUserPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, 64, PARAMS)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

/** Accepts our scrypt hashes and legacy Laravel bcrypt ($2y$) hashes. */
export async function checkUserPassword(hash: string, password: string): Promise<{ ok: boolean, needsRehash: boolean }> {
  if (hash.startsWith('$2')) {
    const ok = await bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2b$'))
    return { ok, needsRehash: ok }
  }
  const [scheme, salt, key] = hash.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return { ok: false, needsRehash: false }
  const expected = Buffer.from(key, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, PARAMS)
  return { ok: timingSafeEqual(actual, expected), needsRehash: false }
}
