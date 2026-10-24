export default defineEventHandler(async (event) => {
  await clearUserSession(event)
  return { status: 'ok' as const }
})
