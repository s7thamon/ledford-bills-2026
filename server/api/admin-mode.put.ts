import { z } from 'zod'

const Body = z.object({ enabled: z.boolean() })

export default defineEventHandler(async (event) => {
  const { enabled } = await readValidatedBody(event, Body.parse)
  await setUserSession(event, { adminMode: enabled })
  return { adminMode: enabled }
})
