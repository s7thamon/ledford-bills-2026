import { z } from 'zod'
import { changePassword } from '../../services/auth'

const Body = z.object({
  currentPassword: z.string().min(1).max(255),
  password: newPasswordSchema
})

export default defineEventHandler(async (event) => {
  const { currentPassword, password } = await readValidatedBody(event, Body.parse)
  const userId = await currentUserId(event)
  rateLimit(`password-change:${userId}`, 5, 15 * 60_000)
  if (!await changePassword(userId, currentPassword, password)) {
    throw createError({ statusCode: 422, statusMessage: 'Your current password is incorrect.' })
  }
  return { status: 'ok' as const }
})
