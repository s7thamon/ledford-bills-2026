import { deleteRecurring } from '../../services/recurring'

export default defineEventHandler(async (event) => {
  const row = await deleteRecurring(idParam(event))
  await broadcast(event, { topics: ['recurring'], message: `deleted recurring ${row.name}` })
  return { status: 'ok' as const }
})
