import { z } from 'zod'
import { updateHeldBill } from '../../services/held-bills'

const Body = z.object({
  name: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive().max(100_000_000)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  const held = await updateHeldBill(idParam(event), body)
  await broadcast(event, { topics: ['held-bills'], message: `edited held bill ${held.name}` })
  return held
})
