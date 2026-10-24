import { z } from 'zod'
import { createBill } from '../../services/bills'

const Body = z.object({
  name: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive().max(100_000_000)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  const bill = await createBill({ ...body, createdBy: await currentUserId(event) })
  await broadcast(event, { topics: ['bills'], message: `added ${bill.name} (${formatMoney(bill.amountCents)})` })
  return bill
})
