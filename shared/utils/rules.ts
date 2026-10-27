import { shareDue, type CreditLike } from './credits'

export interface ParticipantLike { userId: number, amountCents: number, paidAt: string | Date | null }
export interface BillLike {
  amountCents: number
  cardPaidAt: string | Date | null
  participants: ParticipantLike[]
  /** Set when the bill was paid by check from the shared account. */
  paidByCheck?: boolean
  credit?: CreditLike | null
  refunds?: { amountCents: number }[]
}

export interface ReimbursementLike {
  createdBy: number
  otherUserId: number
  transferCompletedAt: string | Date | null
  completedAt: string | Date | null
}

export const canEditBill = (bill: BillLike) => bill.participants.every(p => !p.paidAt)
/**
 * A credit can come back off a bill until real money moves: card unpaid and only credit-covered shares "paid".
 * Never once the bill was itself refunded, or that money would come back twice.
 */
export const canRemoveCredit = (bill: BillLike) => !!bill.credit && !bill.cardPaidAt && !bill.refunds?.length
  && bill.participants.every(p => !p.paidAt || shareDue(p, bill.credit) === 0)
/** Editable, or only "paid" because a refund credit covered those shares (editing then returns the credit). */
export const canEditAmounts = (bill: BillLike) => canEditBill(bill) || canRemoveCredit(bill)
export const canDeleteBill = (bill: BillLike) => canEditBill(bill) && !bill.cardPaidAt
export const allParticipantsPaid = (bill: BillLike) => bill.participants.length > 0 && bill.participants.every(p => p.paidAt)
/** False for check bills, which never go on the shared Citi card. */
export const onSharedCard = (bill: BillLike) => !bill.paidByCheck
/** Bills on the Settings "Paid Directly" list (the mortgage) are paid from the shared account, never Citi. */
export const isDirectPayName = (name: string, names: string[]) => names.some(n => n.toLowerCase() === name.toLowerCase())
/** Only an unpaid bill that goes on Citi can use refund credit, and only once. */
export const canTakeCredit = (bill: BillLike, directPay: boolean) =>
  canEditBill(bill) && !bill.cardPaidAt && onSharedCard(bill) && !bill.credit && !directPay
/** Admin only: a paid shared-card bill that actually went on a personal card, settled by hand before deleting. */
export const canAdminDeleteBill = (bill: BillLike, directPay: boolean) =>
  !canDeleteBill(bill) && !bill.cardPaidAt && onSharedCard(bill) && !directPay
export const canMarkCardPaid = (bill: BillLike) => !bill.cardPaidAt && onSharedCard(bill) && allParticipantsPaid(bill)

/** You can always pay your own share; admin mode lets you mark anyone's. */
export const canMarkParticipantPaid = (actorId: number, targetUserId: number, adminMode: boolean) =>
  actorId === targetUserId || adminMode

export const canEditReimbursement = (r: ReimbursementLike, userId: number) =>
  r.createdBy === userId && !r.completedAt && !r.transferCompletedAt
export const canMarkTransferComplete = (r: ReimbursementLike, userId: number) =>
  r.otherUserId === userId && !r.completedAt && !r.transferCompletedAt
export const canMarkReimbursementComplete = (r: ReimbursementLike, userId: number) =>
  r.createdBy === userId && !r.completedAt && !!r.transferCompletedAt

export type ReimbursementStatus = 'awaiting' | 'sent' | 'received'
export const reimbursementStatus = (r: ReimbursementLike): ReimbursementStatus =>
  r.completedAt ? 'received' : r.transferCompletedAt ? 'sent' : 'awaiting'
