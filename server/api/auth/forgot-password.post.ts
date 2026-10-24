import { z } from 'zod'
import { requestPasswordReset } from '../../services/auth'

const Body = z.object({ email: z.email().max(255) })

export default defineEventHandler(async (event) => {
  const { email } = await readValidatedBody(event, Body.parse)
  rateLimit(`forgot:ip:${clientIp(event)}`, 5, 15 * 60_000)
  await requestPasswordReset(email)
  // Same answer whether or not the email exists.
  return { status: 'sent' as const }
})
