import { z } from 'zod'
import { updateBill } from '../../services/bills'

const Body = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  splits: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100_000_000)).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  const bill = await updateBill(idParam(event), body as { name?: string, amountCents?: number, splits?: Record<number, number> })
  await broadcast(event, { topics: ['bills'], message: `edited ${bill.name}` })
  return bill
})
