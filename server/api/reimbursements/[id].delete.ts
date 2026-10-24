import { deleteReimbursement } from '../../services/reimbursements'

export default defineEventHandler(async (event) => {
  const row = await deleteReimbursement(idParam(event), await currentUserId(event))
  await broadcast(event, { topics: ['reimbursements'], message: `deleted reimbursement ${row.name}` })
  return { status: 'ok' as const }
})
