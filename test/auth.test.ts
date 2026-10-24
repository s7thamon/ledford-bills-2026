import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { useDb } from '../server/db/client'
import {
  attemptLogin, changePassword, checkTrustedDevice, confirmEmailChange, createTrustedDevice, findUserByEmail,
  issueLoginCode, LOGIN_CODE_MAX_ATTEMPTS, requestEmailChange, requestPasswordReset, resetPassword, verifyLoginCode
} from '../server/services/auth'
import { sentMail } from '../server/utils/mail'
import { rateLimit } from '../server/utils/rate-limit'
import { PASSWORD, resetDb, seedUsers } from './helpers'

let tim: number

beforeEach(async () => {
  await resetDb()
  ;({ tim } = await seedUsers())
})

const lastCode = () => sentMail.at(-1)!.subject.match(/(\d{6})$/)![1]!
const lastToken = () => sentMail.at(-1)!.action!.url.split('token=')[1]!

describe('auth', () => {
  it('checks passwords case-insensitively by email', async () => {
    expect(await attemptLogin('TIM@example.com', PASSWORD)).not.toBeNull()
    expect(await attemptLogin('tim@example.com', 'wrong')).toBeNull()
    expect(await attemptLogin('nobody@example.com', PASSWORD)).toBeNull()
  })

  it('upgrades legacy Laravel bcrypt hashes on login', async () => {
    // bcrypt of "secret-password" with Laravel's $2y$ prefix
    const bcrypt = (await import('bcryptjs')).default
    const legacy = (await bcrypt.hash('secret-password', 4)).replace(/^\$2b\$/, '$2y$')
    await useDb().execute(sql`UPDATE users SET password = ${legacy} WHERE id = ${tim}`)
    expect(await attemptLogin('tim@example.com', 'secret-password')).not.toBeNull()
    expect((await findUserByEmail('tim@example.com'))!.password.startsWith('scrypt$')).toBe(true)
    expect(await attemptLogin('tim@example.com', 'secret-password')).not.toBeNull()
  })

  it('verifies emailed codes once, and locks after too many wrong tries', async () => {
    const user = (await findUserByEmail('tim@example.com'))!
    await issueLoginCode(user)
    const code = lastCode()
    expect(await verifyLoginCode(tim, code)).not.toBeNull()
    expect(await verifyLoginCode(tim, code)).toBeNull()

    await issueLoginCode(user)
    const good = lastCode()
    const bad = good === '000000' ? '111111' : '000000'
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i++) expect(await verifyLoginCode(tim, bad)).toBeNull()
    expect(await verifyLoginCode(tim, good)).toBeNull()
  })

  it('trusts a device token only for its user', async () => {
    const token = await createTrustedDevice(tim, 'test')
    expect(await checkTrustedDevice(tim, token)).toBe(true)
    expect(await checkTrustedDevice(tim + 1, token)).toBe(false)
    expect(await checkTrustedDevice(tim, 'forged')).toBe(false)
  })

  it('resets passwords with a one-time token and forgets trusted devices', async () => {
    const token = await createTrustedDevice(tim, 'test')
    await requestPasswordReset('tim@example.com')
    const reset = lastToken()
    expect(await resetPassword(reset, 'NewPassword123')).toBe(true)
    expect(await resetPassword(reset, 'Another123456')).toBe(false)
    expect(await attemptLogin('tim@example.com', 'NewPassword123')).not.toBeNull()
    expect(await checkTrustedDevice(tim, token)).toBe(false)
  })

  it('stays silent for unknown reset emails', async () => {
    await requestPasswordReset('nobody@example.com')
    expect(sentMail).toHaveLength(0)
  })

  it('changes email only after confirmation', async () => {
    const user = (await findUserByEmail('tim@example.com'))!
    await requestEmailChange(user, 'tim@new.example')
    expect(sentMail.at(-1)!.to).toBe('tim@new.example')
    expect(await findUserByEmail('tim@new.example')).toBeUndefined()
    expect((await confirmEmailChange(lastToken()))!.email).toBe('tim@new.example')
  })

  it('requires the current password to change it', async () => {
    expect(await changePassword(tim, 'wrong', 'NewPassword123')).toBe(false)
    expect(await changePassword(tim, PASSWORD, 'NewPassword123')).toBe(true)
  })

  it('rate limits', () => {
    rateLimit('t', 2, 60_000)
    rateLimit('t', 2, 60_000)
    expect(() => rateLimit('t', 2, 60_000)).toThrow(/Too many/)
  })
})
