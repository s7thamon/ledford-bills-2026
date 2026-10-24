import { z } from 'zod'
import { paySelected } from '../../services/bills'

const Body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  target: z.enum(['me', 'card'])
})

export default defineEventHandler(async (event) => {
  const { ids, target } = await readValidatedBody(event, Body.parse)
  const changed = await paySelected(ids, await currentUserId(event), target)
  if (changed) {
    const noun = changed === 1 ? 'bill' : 'bills'
    await broadcast(event, { topics: ['bills'], message: target === 'me' ? `paid ${changed} ${noun}` : `paid the card for ${changed} ${noun}` })
  }
  return { changed }
})
