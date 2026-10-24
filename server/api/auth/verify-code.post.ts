import { z } from 'zod'
import { verifyLoginCode } from '../../services/auth'

const Body = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })

export default defineEventHandler(async (event) => {
  const { code } = await readValidatedBody(event, Body.parse)
  const session = await getUserSession(event)
  if (!session.pendingUserId) {
    throw createError({ statusCode: 401, statusMessage: 'Your sign-in expired. Please sign in again.' })
  }
  rateLimit(`code:ip:${clientIp(event)}`, 20, 15 * 60_000)

  const user = await verifyLoginCode(session.pendingUserId, code)
  if (!user) {
    throw createError({ statusCode: 422, statusMessage: 'That code is invalid or expired.' })
  }

  await trustThisDevice(event, user.id)
  await startSession(event, user)
  return { status: 'ok' as const }
})
