import { markCardPaid } from '../../../services/bills'

export default defineEventHandler(async (event) => {
  const bill = await markCardPaid(idParam(event))
  await broadcast(event, { topics: ['bills'], message: `paid the card for ${bill.name}` })
  return { status: 'ok' as const }
})
