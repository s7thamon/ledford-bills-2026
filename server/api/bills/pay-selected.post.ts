import { z } from 'zod'
import { paySelected } from '../../services/bills'
import { getDirectPayNames } from '../../services/settings'

const Body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  target: z.enum(['me', 'card'])
})

export default defineEventHandler(async (event) => {
  const { ids, target } = await readValidatedBody(event, Body.parse)
  const names = await paySelected(ids, await currentUserId(event), target)
  if (names.length) {
    const noun = names.length === 1 ? 'bill' : 'bills'
    await broadcast(event, { topics: ['bills'], message: target === 'me' ? `paid ${names.length} ${noun}` : `paid the ${payTarget(names, await getDirectPayNames())} for ${names.length} ${noun}` })
  }
  return { changed: names.length }
})
