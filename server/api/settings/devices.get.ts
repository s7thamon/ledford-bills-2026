import { listTrustedDevices } from '../../services/auth'

export default defineEventHandler(async (event) => {
  return listTrustedDevices(await currentUserId(event), getCookie(event, TRUSTED_COOKIE))
})
