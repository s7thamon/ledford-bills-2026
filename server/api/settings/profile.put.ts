import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { schema, useDb } from '../../db/client'
import { findUserByEmail, publicUser, requestEmailChange } from '../../services/auth'

const Body = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.email().max(255)
})

export default defineEventHandler(async (event) => {
  const { name, email } = await readValidatedBody(event, Body.parse)
  const userId = await currentUserId(event)
  const db = useDb()
  await db.update(schema.users).set({ name }).where(eq(schema.users.id, userId))
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!

  let emailPending = false
  if (email.toLowerCase() !== user.email) {
    const taken = await findUserByEmail(email)
    if (taken) throw createError({ statusCode: 422, statusMessage: 'That email is already in use.' })
    rateLimit(`email-change:${userId}`, 3, 60 * 60_000)
    await requestEmailChange(user, email)
    emailPending = true
  }

  await setUserSession(event, { user: publicUser(user) })
  await broadcast(event, { topics: ['users'] })
  return { emailPending }
})
