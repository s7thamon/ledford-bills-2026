import { z } from 'zod'
import { setPaidWithCard } from '../../../services/bills'

const Body = z.object({ userId: z.number().int().positive().nullable(), check: z.boolean().default(false) })

export default defineEventHandler(async (event) => {
  const { userId, check } = await readValidatedBody(event, Body.parse)
  const bill = await setPaidWithCard(idParam(event), userId, check)
  await broadcast(event, { topics: ['bills'] })
  return bill
})
