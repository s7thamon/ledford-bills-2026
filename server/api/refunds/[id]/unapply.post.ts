import { unapplyRefund } from '../../../services/refunds'

export default defineEventHandler(async (event) => {
  await unapplyRefund(idParam(event))
  await broadcast(event, { topics: ['bills'] })
  return { status: 'ok' as const }
})
