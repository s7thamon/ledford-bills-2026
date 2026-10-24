export interface ParticipantLike { userId: number, amountCents: number, paidAt: string | Date | null }
export interface BillLike { amountCents: number, cardPaidAt: string | Date | null, participants: ParticipantLike[] }

export interface ReimbursementLike {
  createdBy: number
  otherUserId: number
  transferCompletedAt: string | Date | null
  completedAt: string | Date | null
}

export const canEditBill = (bill: BillLike) => bill.participants.every(p => !p.paidAt)
export const canDeleteBill = (bill: BillLike) => canEditBill(bill) && !bill.cardPaidAt
export const allParticipantsPaid = (bill: BillLike) => bill.participants.length > 0 && bill.participants.every(p => p.paidAt)
export const canMarkCardPaid = (bill: BillLike) => !bill.cardPaidAt && allParticipantsPaid(bill)

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
