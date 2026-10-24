import { z } from 'zod'
import { confirmEmailChange, publicUser } from '../../services/auth'

const Body = z.object({ token: z.string().min(20).max(200) })

export default defineEventHandler(async (event) => {
  const { token } = await readValidatedBody(event, Body.parse)
  rateLimit(`confirm-email:ip:${clientIp(event)}`, 10, 15 * 60_000)
  const user = await confirmEmailChange(token)
  if (!user) {
    throw createError({ statusCode: 422, statusMessage: 'This link is invalid, expired, or the email is already in use.' })
  }
  const session = await getUserSession(event)
  if (session.user?.id === user.id) await setUserSession(event, { user: publicUser(user) })
  return { status: 'ok' as const }
})
