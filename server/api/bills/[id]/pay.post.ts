import { z } from 'zod'
import { getBill, markParticipantPaid } from '../../../services/bills'
import { findUser } from '../../../services/users'

const Body = z.object({ userId: z.number().int().positive().optional() })

export default defineEventHandler(async (event) => {
  const { userId } = await readValidatedBody(event, Body.parse)
  const session = await requireUserSession(event)
  const billId = idParam(event)
  const target = userId ?? session.user.id

  const changed = await markParticipantPaid(billId, target, session.user.id, !!session.adminMode)
  if (changed) {
    const bill = await getBill(billId)
    const share = formatMoney(bill.participants.find(p => p.userId === target)?.amountCents ?? 0)
    const message = target === session.user.id
      ? `paid ${bill.name} (${share})`
      : `marked ${(await findUser(target))?.name ?? 'someone'} paid on ${bill.name} (${share})`
    await broadcast(event, { topics: ['bills'], message })
  }
  return { changed }
})
