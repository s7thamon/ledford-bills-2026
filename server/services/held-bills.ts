import { asc, eq, lte } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db/client'
import { shiftMonth, todayIso } from '../../shared/utils/dates'
import { createBill } from './bills'

const { heldBills } = schema

export const listHeldBills = () => useDb().select().from(heldBills).orderBy(asc(heldBills.addOn), asc(heldBills.id))

async function getHeldBill(id: number) {
  const [row] = await useDb().select().from(heldBills).where(eq(heldBills.id, id))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Held bill not found. It may already have been added.' })
  return row
}

/** Holds a bill until the 1st of next month, when releaseHeldBills adds it. */
export async function holdBill(input: { name: string, amountCents: number, createdBy: number }, today = todayIso()) {
  const [res] = await useDb().insert(heldBills).values({
    name: input.name.trim(),
    amountCents: input.amountCents,
    createdBy: input.createdBy,
    addOn: `${shiftMonth(today.slice(0, 7), 1)}-01`
  })
  return getHeldBill(res.insertId)
}

export async function updateHeldBill(id: number, input: { name: string, amountCents: number }) {
  await getHeldBill(id)
  await useDb().update(heldBills).set({ name: input.name.trim(), amountCents: input.amountCents }).where(eq(heldBills.id, id))
  return getHeldBill(id)
}

export async function cancelHeldBill(id: number) {
  const row = await getHeldBill(id)
  await useDb().delete(heldBills).where(eq(heldBills.id, id))
  return row
}

/**
 * Turns every held bill that is due into a normal bill dated its 1st. Runs after the recurring bills, so these land
 * below them. A missed night catches up on the next run.
 */
export async function releaseHeldBills(today = todayIso()): Promise<number> {
  const due = await useDb().select().from(heldBills).where(lte(heldBills.addOn, today)).orderBy(asc(heldBills.id))
  for (const h of due) {
    // shortcut: create then delete, so a crash in between duplicates rather than loses a bill; fine for one daily job.
    await createBill({ name: h.name, amountCents: h.amountCents, createdBy: h.createdBy, addedOn: h.addOn })
    await useDb().delete(heldBills).where(eq(heldBills.id, h.id))
  }
  return due.length
}
