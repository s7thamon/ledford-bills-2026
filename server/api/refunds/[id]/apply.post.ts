import { z } from 'zod'
import { applyRefund } from '../../../services/refunds'

const Body = z.object({ billId: z.number().int().positive() })

export default defineEventHandler(async (event) => {
  const { billId } = await readValidatedBody(event, Body.parse)
  const bill = await applyRefund(idParam(event), billId)
  await broadcast(event, { topics: ['bills'] })
  return bill
})
