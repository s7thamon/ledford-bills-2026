import { markTransferComplete } from '../../../services/reimbursements'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const row = await markTransferComplete(idParam(event), session.user.id, !!session.adminMode)
  await broadcast(event, { topics: ['reimbursements'], message: `sent ${formatMoney(row.owedCents)} for ${row.name}` })
  return { status: 'ok' as const }
})
