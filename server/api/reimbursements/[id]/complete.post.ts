import { markReimbursementComplete } from '../../../services/reimbursements'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const row = await markReimbursementComplete(idParam(event), session.user.id, !!session.adminMode)
  await broadcast(event, { topics: ['reimbursements'], message: `confirmed receiving ${formatMoney(row.owedCents)} for ${row.name}` })
  return { status: 'ok' as const }
})
