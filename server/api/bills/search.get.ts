import { z } from 'zod'
import { searchBills } from '../../services/bills'

const Query = z.object({ q: z.string().max(255).default('') })

export default defineEventHandler(async (event) => {
  const { q } = await getValidatedQuery(event, Query.parse)
  return searchBills(q)
})
