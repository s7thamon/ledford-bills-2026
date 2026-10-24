import { z } from 'zod'
import { moveRecurring } from '../../../services/recurring'

const Body = z.object({ direction: z.union([z.literal(-1), z.literal(1)]) })

export default defineEventHandler(async (event) => {
  const { direction } = await readValidatedBody(event, Body.parse)
  await moveRecurring(idParam(event), direction)
  await broadcast(event, { topics: ['recurring'] })
  return { status: 'ok' as const }
})
