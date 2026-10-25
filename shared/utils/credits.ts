export interface CreditLike { amountCents: number, shares: Record<number, number> }

interface Share { userId: number, amountCents: number }

/**
 * Split a refund in proportion to the original bill's shares so the parts add up exactly.
 * Largest remainder; ties go to the larger share, then the lower user id. All-zero shares split equally.
 */
export function splitRefund(refundCents: number, shares: Share[]): Record<number, number> {
  const weights = shares.some(s => s.amountCents > 0) ? shares : shares.map(s => ({ ...s, amountCents: 1 }))
  const weightTotal = weights.reduce((sum, s) => sum + s.amountCents, 0)
  const parts = weights.map((s) => {
    const exact = refundCents * s.amountCents / weightTotal
    return { userId: s.userId, weight: s.amountCents, cents: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let leftover = refundCents - parts.reduce((sum, p) => sum + p.cents, 0)
  for (const p of [...parts].sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.userId - b.userId)) {
    if (leftover <= 0) break
    p.cents++
    leftover--
  }
  return Object.fromEntries(parts.map(p => [p.userId, p.cents]))
}

export function canAbsorb(bill: { amountCents: number, participants: Share[] }, credit: CreditLike): boolean {
  return bill.amountCents >= credit.amountCents
    && Object.entries(credit.shares).every(([userId, cents]) => (bill.participants.find(p => p.userId === Number(userId))?.amountCents ?? 0) >= cents)
}

export const shareDue = (participant: Share, credit?: CreditLike | null) =>
  Math.max(0, participant.amountCents - (credit?.shares[participant.userId] ?? 0))

export const cardDue = (bill: { amountCents: number, credit?: CreditLike | null }) =>
  Math.max(0, bill.amountCents - (bill.credit?.amountCents ?? 0))
