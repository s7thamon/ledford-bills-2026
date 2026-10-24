import { createHash, randomBytes, randomInt } from 'node:crypto'
import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { schema, useDb } from '../db/client'
import { appUrl, sendMail } from '../utils/mail'
import { checkUserPassword, hashUserPassword } from '../utils/password'

const { users, authTokens, trustedDevices } = schema

export const LOGIN_CODE_TTL_MS = 10 * 60_000
export const LOGIN_CODE_MAX_ATTEMPTS = 5
export const TRUSTED_DEVICE_TTL_MS = 120 * 24 * 60 * 60_000
const RESET_TTL_MS = 60 * 60_000

export type AuthUser = typeof users.$inferSelect
export const publicUser = (u: AuthUser) => ({ id: u.id, name: u.name, email: u.email })

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const randomToken = () => randomBytes(32).toString('base64url')
const normalizeEmail = (email: string) => email.trim().toLowerCase()

export async function findUserByEmail(email: string) {
  return useDb().query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) })
}

export async function createUser(input: { name: string, email: string, password: string }) {
  const [res] = await useDb().insert(users).values({
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    password: await hashUserPassword(input.password),
    emailVerifiedAt: new Date()
  })
  return res.insertId
}

/** Returns the user when the password matches. Legacy bcrypt hashes are upgraded on the spot. */
export async function attemptLogin(email: string, password: string): Promise<AuthUser | null> {
  const user = await findUserByEmail(email)
  if (!user) {
    await hashUserPassword(password) // keep timing similar for unknown emails
    return null
  }
  const { ok, needsRehash } = await checkUserPassword(user.password, password)
  if (!ok) return null
  if (needsRehash) {
    await useDb().update(users).set({ password: await hashUserPassword(password) }).where(eq(users.id, user.id))
  }
  return user
}

export async function issueLoginCode(user: AuthUser): Promise<void> {
  const db = useDb()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.delete(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.type, 'login_code')))
  await db.insert(authTokens).values({
    userId: user.id,
    type: 'login_code',
    tokenHash: sha256(`${user.id}:${code}`),
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS)
  })
  await sendMail({
    to: user.email,
    subject: `Your Ledford Bills sign-in code: ${code}`,
    lines: [`Your sign-in code is ${code}.`, 'It expires in 10 minutes. If you did not try to sign in, change your password.']
  })
}

export async function verifyLoginCode(userId: number, code: string): Promise<AuthUser | null> {
  const db = useDb()
  const token = await db.query.authTokens.findFirst({
    where: and(eq(authTokens.userId, userId), eq(authTokens.type, 'login_code'), gt(authTokens.expiresAt, new Date())),
    orderBy: desc(authTokens.id)
  })
  if (!token || token.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return null
  if (token.tokenHash !== sha256(`${userId}:${code.trim()}`)) {
    await db.update(authTokens).set({ attempts: token.attempts + 1 }).where(eq(authTokens.id, token.id))
    return null
  }
  await db.delete(authTokens).where(eq(authTokens.id, token.id))
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user && !user.emailVerifiedAt) {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId))
  }
  return user ?? null
}

export async function createTrustedDevice(userId: number, userAgent: string | undefined): Promise<string> {
  const token = randomToken()
  await useDb().insert(trustedDevices).values({
    userId,
    tokenHash: sha256(token),
    userAgent: userAgent?.slice(0, 255) ?? null,
    expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS)
  })
  return token
}

/** Valid device tokens slide their expiry forward on each use. */
export async function checkTrustedDevice(userId: number, token: string): Promise<boolean> {
  const db = useDb()
  const device = await db.query.trustedDevices.findFirst({
    where: and(eq(trustedDevices.tokenHash, sha256(token)), eq(trustedDevices.userId, userId), gt(trustedDevices.expiresAt, new Date()))
  })
  if (!device) return false
  await db.update(trustedDevices)
    .set({ lastUsedAt: new Date(), expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS) })
    .where(eq(trustedDevices.id, device.id))
  return true
}

export async function listTrustedDevices(userId: number, currentToken?: string) {
  const db = useDb()
  await db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, new Date()))
  const rows = await db.query.trustedDevices.findMany({ where: eq(trustedDevices.userId, userId), orderBy: desc(trustedDevices.lastUsedAt) })
  const currentHash = currentToken ? sha256(currentToken) : null
  return rows.map(d => ({ id: d.id, userAgent: d.userAgent, lastUsedAt: d.lastUsedAt, expiresAt: d.expiresAt, current: d.tokenHash === currentHash }))
}

export async function revokeTrustedDevice(userId: number, deviceId: number) {
  await useDb().delete(trustedDevices).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId)))
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email)
  if (!user) return
  const db = useDb()
  const token = randomToken()
  await db.delete(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.type, 'password_reset')))
  await db.insert(authTokens).values({ userId: user.id, type: 'password_reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) })
  await sendMail({
    to: user.email,
    subject: 'Reset your Ledford Bills password',
    lines: ['Someone asked to reset your password. The link expires in 60 minutes.', 'If this was not you, you can ignore this email.'],
    action: { label: 'Reset Password', url: appUrl(`/reset-password?token=${token}`) }
  })
}

async function consumeToken(type: 'password_reset' | 'email_change', token: string) {
  const db = useDb()
  const row = await db.query.authTokens.findFirst({
    where: and(eq(authTokens.type, type), eq(authTokens.tokenHash, sha256(token)), gt(authTokens.expiresAt, new Date()))
  })
  if (!row) return null
  await db.delete(authTokens).where(eq(authTokens.id, row.id))
  return row
}

/** Resetting a password also signs out every trusted device. */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  const row = await consumeToken('password_reset', token)
  if (!row) return false
  const db = useDb()
  await db.update(users).set({ password: await hashUserPassword(password), emailVerifiedAt: new Date() }).where(eq(users.id, row.userId))
  await db.delete(trustedDevices).where(eq(trustedDevices.userId, row.userId))
  return true
}

export async function changePassword(userId: number, current: string, next: string): Promise<boolean> {
  const db = useDb()
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!user || !(await checkUserPassword(user.password, current)).ok) return false
  await db.update(users).set({ password: await hashUserPassword(next) }).where(eq(users.id, userId))
  return true
}

/** Email changes only apply after the new address clicks the link. */
export async function requestEmailChange(user: AuthUser, newEmail: string): Promise<void> {
  const db = useDb()
  const token = randomToken()
  await db.delete(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.type, 'email_change')))
  await db.insert(authTokens).values({ userId: user.id, type: 'email_change', tokenHash: sha256(token), meta: normalizeEmail(newEmail), expiresAt: new Date(Date.now() + RESET_TTL_MS) })
  await sendMail({
    to: normalizeEmail(newEmail),
    subject: 'Confirm your new Ledford Bills email',
    lines: [`Confirm that ${normalizeEmail(newEmail)} should become the email for ${user.name}.`],
    action: { label: 'Confirm Email', url: appUrl(`/verify-email?token=${token}`) }
  })
}

export async function confirmEmailChange(token: string): Promise<AuthUser | null> {
  const row = await consumeToken('email_change', token)
  if (!row?.meta) return null
  const db = useDb()
  if (await findUserByEmail(row.meta)) return null
  await db.update(users).set({ email: row.meta, emailVerifiedAt: new Date() }).where(eq(users.id, row.userId))
  return (await db.query.users.findFirst({ where: eq(users.id, row.userId) })) ?? null
}
