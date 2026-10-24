import { z } from 'zod'
import { setRecurringActive } from '../../../services/recurring'

const Body = z.object({ active: z.boolean() })

export default defineEventHandler(async (event) => {
  const { active } = await readValidatedBody(event, Body.parse)
  const row = await setRecurringActive(idParam(event), active)
  await broadcast(event, { topics: ['recurring'], message: `${active ? 'resumed' : 'paused'} recurring ${row.name}` })
  return row
})
