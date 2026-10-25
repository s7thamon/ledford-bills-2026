import { deleteRefund } from '../../services/refunds'

export default defineEventHandler(async (event) => {
  await deleteRefund(idParam(event))
  await broadcast(event, { topics: ['bills'] })
  return { status: 'ok' as const }
})
