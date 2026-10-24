import { z } from 'zod'
import { listBills } from '../../services/bills'

const Query = z.object({
  month: z.string().refine(isMonth).optional(),
  userUnpaid: z.stringbool().optional(),
  cardUnpaid: z.stringbool().optional()
})

export default defineEventHandler(async (event) => {
  const q = await getValidatedQuery(event, Query.parse)
  return listBills({ month: q.month ?? currentMonth(), userId: await currentUserId(event), userUnpaid: q.userUnpaid, cardUnpaid: q.cardUnpaid })
})
