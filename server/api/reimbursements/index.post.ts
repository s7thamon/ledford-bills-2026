import { createReimbursement } from '../../services/reimbursements'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, reimbursementSchema.parse)
  const row = await createReimbursement({ ...body, createdBy: await currentUserId(event) })
  await broadcast(event, { topics: ['reimbursements'], message: `asked to be reimbursed for ${row.name} (${formatMoney(row.owedCents)})` })
  return row
})
