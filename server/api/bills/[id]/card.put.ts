import { z } from 'zod'
import { setPaidWithCard } from '../../../services/bills'

const Body = z.object({ userId: z.number().int().positive().nullable() })

export default defineEventHandler(async (event) => {
  const { userId } = await readValidatedBody(event, Body.parse)
  const bill = await setPaidWithCard(idParam(event), userId)
  await broadcast(event, { topics: ['bills'] })
  return bill
})
