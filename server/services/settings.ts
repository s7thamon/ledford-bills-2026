import { eq } from 'drizzle-orm'
import { schema, useDb } from '../db/client'

const { settings } = schema

/** Used until someone saves the list in Settings. */
export const DEFAULT_DIRECT_PAY = ['Ledford Mortgage', 'Ledford Mortgage - Principal']

/** Bill names paid straight to the payee, so Reconcile never expects them on the card statement. */
export async function getDirectPayNames(): Promise<string[]> {
  const row = await useDb().query.settings.findFirst({ where: eq(settings.key, 'directPay') })
  return row ? row.value as string[] : DEFAULT_DIRECT_PAY
}

export async function setDirectPayNames(names: string[]) {
  const value = [...new Set(names.map(n => n.trim()).filter(Boolean))]
  await useDb().insert(settings).values({ key: 'directPay', value }).onDuplicateKeyUpdate({ set: { value } })
  return value
}
