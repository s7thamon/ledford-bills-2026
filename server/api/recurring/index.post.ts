import { createRecurring, type RecurringInput } from '../../services/recurring'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, recurringSchema.parse) as RecurringInput
  const row = await createRecurring(body, await currentUserId(event))
  await broadcast(event, { topics: ['recurring'], message: `added recurring ${row.type === 'bill' ? 'bill' : 'reimbursement'} ${row.name}` })
  return row
})
