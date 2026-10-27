import { z } from 'zod'
import { setPaidByCheck } from '../../../services/bills'

const Body = z.object({ check: z.boolean() })

export default defineEventHandler(async (event) => {
  const { check } = await readValidatedBody(event, Body.parse)
  const bill = await setPaidByCheck(idParam(event), check)
  await broadcast(event, { topics: ['bills'] })
  return bill
})
