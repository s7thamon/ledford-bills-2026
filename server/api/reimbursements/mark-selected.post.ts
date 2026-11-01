import { z } from 'zod'
import { markSelected } from '../../services/reimbursements'

const Body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  step: z.enum(['sent', 'received'])
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const { ids, step } = await readValidatedBody(event, Body.parse)
  const rows = await markSelected(ids, session.user.id, !!session.adminMode, step)
  if (rows.length) {
    const cents = formatMoney(rows.reduce((s, r) => s + r.owedCents, 0))
    const noun = rows.length === 1 ? 'reimbursement' : 'reimbursements'
    await broadcast(event, { topics: ['reimbursements'], message: step === 'sent' ? `sent ${cents} for ${rows.length} ${noun}` : `confirmed receiving ${cents} for ${rows.length} ${noun}` })
  }
  return { changed: rows.length }
})
