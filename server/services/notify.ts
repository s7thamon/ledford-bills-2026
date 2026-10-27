import { inArray } from 'drizzle-orm'
import { schema, useDb } from '../db/client'
import { appUrl, queueMail } from '../utils/mail'
import { formatMoney } from '../../shared/utils/money'
import { monthLabel } from '../../shared/utils/dates'
import { cardOwner } from './users'

interface BillInfo { name: string, amountCents: number, addedOn: string }
interface ReimbursementInfo { name: string, owedCents: number, notes: string | null, createdBy: number, otherUserId: number }

async function usersById(ids: number[]) {
  if (!ids.length) return new Map<number, typeof schema.users.$inferSelect>()
  const rows = await useDb().select().from(schema.users).where(inArray(schema.users.id, ids))
  return new Map(rows.map(u => [u.id, u]))
}

const billUrl = (bill: BillInfo) => appUrl(`/?month=${bill.addedOn.slice(0, 7)}`)
// Gmail threads mails with the same subject, so the amount keeps two same-named bills (two Costco runs) apart.
const billSubject = (prefix: string, bill: BillInfo) => `${prefix} - "${bill.name}" - ${formatMoney(bill.amountCents)}`

export async function billAdded(bill: BillInfo, participants: { userId: number, amountCents: number }[]) {
  const users = await usersById(participants.map(p => p.userId))
  for (const p of participants) {
    const user = users.get(p.userId)
    if (!user) continue
    queueMail({
      to: user.email,
      subject: billSubject('New Bill Added', bill),
      lines: ['A new bill has been added.', `Bill: ${bill.name}`, `Total Amount: ${formatMoney(bill.amountCents)}`, `Your Share: ${formatMoney(p.amountCents)}`],
      action: { label: 'View Bill', url: billUrl(bill) }
    })
  }
}

/** directPay: paid straight from the shared account (the mortgage), so it's the account, not the card, that's ready. */
export async function cardReady(bill: BillInfo, directPay = false) {
  const owner = await cardOwner()
  if (!owner) return
  const what = directPay ? 'Account' : 'Card'
  queueMail({
    to: owner.email,
    subject: billSubject(`${what} Ready to Pay`, bill),
    lines: ['This bill has been paid by all parties.', `Bill: ${bill.name}`, `Total Amount: ${formatMoney(bill.amountCents)}`, `The ${what.toLowerCase()} is now ready to be paid.`],
    action: { label: 'View Bill', url: billUrl(bill) }
  })
}

export async function reimbursementCreated(r: ReimbursementInfo) {
  const users = await usersById([r.createdBy, r.otherUserId])
  const creator = users.get(r.createdBy)
  const other = users.get(r.otherUserId)
  const action = { label: 'View Reimbursements', url: appUrl('/reimbursements') }
  if (creator) {
    queueMail({
      to: creator.email,
      subject: `Reimbursement Submitted - "${r.name}"`,
      lines: [`You have submitted a reimbursement request for ${other?.name ?? 'the other party'}.`, `Name: ${r.name}`, `Amount Owed: ${formatMoney(r.owedCents)}`],
      action
    })
  }
  if (other) {
    queueMail({
      to: other.email,
      subject: `New Reimbursement - "${r.name}"`,
      lines: ['A new reimbursement has been created.', `Name: ${r.name}`, `Amount Owed: ${formatMoney(r.owedCents)}`, ...(r.notes ? [`Notes: ${r.notes}`] : [])],
      action
    })
  }
}

export async function transferCompleted(r: ReimbursementInfo) {
  const creator = (await usersById([r.createdBy])).get(r.createdBy)
  if (!creator) return
  queueMail({
    to: creator.email,
    subject: `Transfer Complete - "${r.name}"`,
    lines: ['The transfer for this reimbursement was marked complete.', `Name: ${r.name}`, `Amount Owed: ${formatMoney(r.owedCents)}`],
    action: { label: 'View Reimbursements', url: appUrl('/reimbursements') }
  })
}

export async function unpaidReminder(month: string, unpaidCount: number) {
  const users = await useDb().select().from(schema.users)
  for (const user of users) {
    queueMail({
      to: user.email,
      subject: `Unpaid Bills Reminder - ${monthLabel(month)}`,
      lines: [`There are unpaid bills from ${monthLabel(month)}.`, `Unpaid bills count: ${unpaidCount}`],
      action: { label: 'View Bills', url: appUrl(`/?month=${month}`) }
    })
  }
}
