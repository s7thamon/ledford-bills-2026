import type { H3Event } from 'h3'
import { createTrustedDevice, publicUser, TRUSTED_DEVICE_TTL_MS, type AuthUser } from '../services/auth'

export const TRUSTED_COOKIE = 'ld_trusted'

export async function startSession(event: H3Event, user: AuthUser) {
  await replaceUserSession(event, { user: publicUser(user), adminMode: false })
}

export async function trustThisDevice(event: H3Event, userId: number) {
  const token = await createTrustedDevice(userId, getRequestHeader(event, 'user-agent'))
  setCookie(event, TRUSTED_COOKIE, token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: TRUSTED_DEVICE_TTL_MS / 1000
  })
}

export function clientIp(event: H3Event) {
  return getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
}

/** The signed-in user id; server middleware guarantees a session for /api routes. */
export async function currentUserId(event: H3Event): Promise<number> {
  const { user } = await requireUserSession(event)
  return user.id
}
