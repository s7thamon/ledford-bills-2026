import { removeCredit } from '../../../services/refunds'

export default defineEventHandler(async (event) => {
  await removeCredit(idParam(event))
  await broadcast(event, { topics: ['bills'] })
  return { status: 'ok' as const }
})
