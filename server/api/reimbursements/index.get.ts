import { z } from 'zod'
import { listReimbursements } from '../../services/reimbursements'

const Query = z.object({
  resolved: z.stringbool().default(false),
  page: z.coerce.number().int().min(1).default(1),
  sort: z.enum(['createdAt', 'name', 'owedCents', 'status']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc')
})

export default defineEventHandler(async (event) => {
  return listReimbursements(await getValidatedQuery(event, Query.parse))
})
