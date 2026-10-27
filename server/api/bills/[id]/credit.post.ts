import { applyCredit } from '../../../services/refunds'

export default defineEventHandler(async (event) => {
  const bill = await applyCredit(idParam(event))
  await broadcast(event, { topics: ['bills'] })
  return bill
})
