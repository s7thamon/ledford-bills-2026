import { markCardPaid } from '../../../services/bills'
import { getDirectPayNames } from '../../../services/settings'

export default defineEventHandler(async (event) => {
  const bill = await markCardPaid(idParam(event))
  await broadcast(event, { topics: ['bills'], message: `paid the ${payTarget([bill.name], await getDirectPayNames())} for ${bill.name}` })
  return { status: 'ok' as const }
})
