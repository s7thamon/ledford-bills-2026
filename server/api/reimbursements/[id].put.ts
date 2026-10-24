import { updateReimbursement } from '../../services/reimbursements'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, reimbursementSchema.parse)
  const row = await updateReimbursement(idParam(event), await currentUserId(event), body)
  await broadcast(event, { topics: ['reimbursements'], message: `updated reimbursement ${row.name}` })
  return row
})
