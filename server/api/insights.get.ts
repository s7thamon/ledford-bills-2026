import { z } from 'zod'
import { billsForInsights } from '../services/bills'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const Query = z.object({ from: month, to: month })

export default defineEventHandler(async (event) => {
  const { from, to } = await getValidatedQuery(event, Query.parse)
  return billsForInsights(from, to)
})
