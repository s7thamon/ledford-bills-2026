import { z } from 'zod'
import { attemptLogin, checkTrustedDevice, issueLoginCode } from '../../services/auth'

const Body = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(255)
})

export default defineEventHandler(async (event) => {
  const { email, password } = await readValidatedBody(event, Body.parse)
  rateLimit(`login:ip:${clientIp(event)}`, 20, 15 * 60_000)
  rateLimit(`login:email:${email.toLowerCase()}`, 10, 15 * 60_000)

  const user = await attemptLogin(email, password)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'These credentials do not match our records.' })
  }

  // LOGIN_CODE_REQUIRED=false turns off the emailed sign-in code (password only).
  const codeRequired = process.env.LOGIN_CODE_REQUIRED !== 'false'
  const deviceToken = getCookie(event, TRUSTED_COOKIE)
  if (!codeRequired || (deviceToken && await checkTrustedDevice(user.id, deviceToken))) {
    await startSession(event, user)
    return { status: 'ok' as const }
  }

  await issueLoginCode(user)
  await replaceUserSession(event, { pendingUserId: user.id })
  return { status: 'code' as const }
})
