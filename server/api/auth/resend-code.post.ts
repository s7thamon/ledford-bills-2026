import { eq } from 'drizzle-orm'
import { schema, useDb } from '../../db/client'
import { issueLoginCode } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.pendingUserId) {
    throw createError({ statusCode: 401, statusMessage: 'Your sign-in expired. Please sign in again.' })
  }
  rateLimit(`resend:${session.pendingUserId}`, 3, 10 * 60_000)
  const user = await useDb().query.users.findFirst({ where: eq(schema.users.id, session.pendingUserId) })
  if (user) await issueLoginCode(user)
  return { status: 'sent' as const }
})
