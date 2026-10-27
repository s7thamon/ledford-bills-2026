import { deleteBill } from '../../services/bills'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const bill = await deleteBill(idParam(event), !!session.adminMode)
  await broadcast(event, { topics: ['bills'], message: `deleted ${bill.name}` })
  return { status: 'ok' as const }
})
