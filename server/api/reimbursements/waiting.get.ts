import { countWaitingOn } from '../../services/reimbursements'

export default defineEventHandler(async event => countWaitingOn(await currentUserId(event)))
