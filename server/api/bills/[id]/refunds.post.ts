import { z } from 'zod'
import { recordRefund } from '../../../services/refunds'

const Body = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  refundedOn: z.iso.date()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, Body.parse)
  const refund = await recordRefund(idParam(event), body, await currentUserId(event))
  // Quiet on purpose: refresh other tabs, no toast, no email.
  await broadcast(event, { topics: ['bills'] })
  return refund
})
