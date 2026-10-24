import { revokeTrustedDevice } from '../../../services/auth'

export default defineEventHandler(async (event) => {
  await revokeTrustedDevice(await currentUserId(event), idParam(event))
  return { status: 'ok' as const }
})
