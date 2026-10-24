import { z } from 'zod'
import { resetPassword } from '../../services/auth'

const Body = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema
})

export default defineEventHandler(async (event) => {
  const { token, password } = await readValidatedBody(event, Body.parse)
  rateLimit(`reset:ip:${clientIp(event)}`, 10, 15 * 60_000)
  if (!await resetPassword(token, password)) {
    throw createError({ statusCode: 422, statusMessage: 'This reset link is invalid or expired.' })
  }
  return { status: 'ok' as const }
})
