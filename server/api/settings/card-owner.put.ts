import { z } from 'zod'
import { setCardOwner } from '../../services/users'

const Body = z.object({ userId: z.number().int().positive() })

export default defineEventHandler(async (event) => {
  const { userId } = await readValidatedBody(event, Body.parse)
  const owner = await setCardOwner(userId)
  await broadcast(event, { topics: ['users'], message: `made ${owner.name} the card owner` })
  return { status: 'ok' as const }
})
