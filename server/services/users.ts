import { asc, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'

const { users } = schema

export type HouseholdUser = { id: number, name: string, isCardOwner: boolean }

export async function listUsers(): Promise<HouseholdUser[]> {
  return useDb()
    .select({ id: users.id, name: users.name, isCardOwner: users.isCardOwner })
    .from(users)
    .orderBy(asc(users.name))
}

export async function findUser(id: number) {
  return useDb().query.users.findFirst({ where: eq(users.id, id) })
}

export async function cardOwner() {
  return useDb().query.users.findFirst({ where: eq(users.isCardOwner, true) })
}

/** First other household member, matching the old two-person assumption. */
export async function otherUserId(userId: number): Promise<number | null> {
  const row = await useDb().select({ id: users.id }).from(users).where(ne(users.id, userId)).orderBy(asc(users.id)).limit(1)
  return row[0]?.id ?? null
}

export async function setCardOwner(userId: number) {
  const db = useDb()
  const owner = await findUser(userId)
  if (!owner) throw createError({ statusCode: 422, statusMessage: 'Unknown user.' })
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isCardOwner: false })
    await tx.update(users).set({ isCardOwner: true }).where(eq(users.id, userId))
  })
  return owner
}
