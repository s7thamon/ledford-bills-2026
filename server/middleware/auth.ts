const PUBLIC_API = ['/api/auth/', '/api/_auth/']

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/') || PUBLIC_API.some(prefix => event.path.startsWith(prefix))) return
  await requireUserSession(event)
})
