import { cancelHeldBill } from '../../services/held-bills'

export default defineEventHandler(async (event) => {
  const held = await cancelHeldBill(idParam(event))
  await broadcast(event, { topics: ['held-bills'], message: `cancelled held bill ${held.name}` })
  return { status: 'ok' as const }
})
