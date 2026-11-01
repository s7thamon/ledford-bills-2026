import { z } from 'zod'
import { holdBill } from '../../services/held-bills'

const Body = z.object({
  name: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive().max(100_000_000)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  const held = await holdBill({ ...body, createdBy: await currentUserId(event) })
  await broadcast(event, { topics: ['held-bills'], message: `held ${held.name} (${formatMoney(held.amountCents)}) for next month` })
  return held
})
