import { deleteBill } from '../../services/bills'

export default defineEventHandler(async (event) => {
  const bill = await deleteBill(idParam(event))
  await broadcast(event, { topics: ['bills'], message: `deleted ${bill.name}` })
  return { status: 'ok' as const }
})
