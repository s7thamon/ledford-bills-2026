import { updateRecurring, type RecurringInput } from '../../services/recurring'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, recurringSchema.parse) as RecurringInput
  const row = await updateRecurring(idParam(event), body)
  await broadcast(event, { topics: ['recurring'], message: `updated recurring ${row.name}` })
  return row
})
