import { z } from 'zod'
import { setDirectPayNames } from '../../services/settings'

const Body = z.object({ names: z.array(z.string().trim().max(255)).max(50) })

export default defineEventHandler(async (event) => {
  const { names } = await readValidatedBody(event, Body.parse)
  return setDirectPayNames(names)
})
