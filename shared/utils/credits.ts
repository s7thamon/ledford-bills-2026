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

export const shareDue = (participant: Share, credit?: CreditLike | null) =>
  Math.max(0, participant.amountCents - (credit?.shares[participant.userId] ?? 0))

export const cardDue = (bill: { amountCents: number, credit?: CreditLike | null }) =>
  Math.max(0, bill.amountCents - (bill.credit?.amountCents ?? 0))

/** One refund's unused credit, per person. Pass pools oldest first. */
export interface CreditPool { refundId: number, sourceBillId: number, left: Record<number, number> }
export interface CreditPiece { refundId: number, userId: number, amountCents: number }

/** Unused credit as pools, oldest refund first. */
export const poolsFromRefunds = (refunds: { id: number, billId: number, refundedOn: string, left: Record<number, number>, leftCents: number }[]): CreditPool[] =>
  refunds.filter(r => r.leftCents > 0)
    .toSorted((a, b) => a.refundedOn.localeCompare(b.refundedOn) || a.id - b.id)
    .map(r => ({ refundId: r.id, sourceBillId: r.billId, left: r.left }))

/**
 * How much of the running credit a bill takes: each share is covered from that person's credit, oldest refund first.
 * A bill never uses its own refund, and the card reduction never exceeds the bill amount (shares can round a cent over).
 */
export function sizeBite(bill: { id: number, amountCents: number, participants: Share[] }, pools: CreditPool[]): CreditPiece[] {
  const pieces: CreditPiece[] = []
  for (const p of bill.participants) {
    let need = p.amountCents
    for (const pool of pools) {
      if (need <= 0) break
      if (pool.sourceBillId === bill.id) continue
      const take = Math.min(pool.left[p.userId] ?? 0, need)
      if (take > 0) pieces.push({ refundId: pool.refundId, userId: p.userId, amountCents: take })
      need -= take
    }
  }
  let excess = pieces.reduce((sum, x) => sum + x.amountCents, 0) - bill.amountCents
  while (excess > 0) {
    // Trim the person taking the most (ties: higher user id), from their last piece.
    const totals = creditFromPieces(pieces).shares
    const userId = Object.keys(totals).map(Number).sort((a, b) => totals[b]! - totals[a]! || b - a)[0]!
    const last = pieces.findLast(x => x.userId === userId)!
    const cut = Math.min(excess, last.amountCents)
    last.amountCents -= cut
    excess -= cut
    if (!last.amountCents) pieces.splice(pieces.indexOf(last), 1)
  }
  return pieces
}

export function creditFromPieces(pieces: CreditPiece[]): CreditLike {
  const shares: Record<number, number> = {}
  for (const x of pieces) shares[x.userId] = (shares[x.userId] ?? 0) + x.amountCents
  return { amountCents: pieces.reduce((sum, x) => sum + x.amountCents, 0), shares }
}

export interface Settlement {
  deposits: { userId: number, cents: number | null }[]
  receivedCents: number
  creditCents: number
  adds: { userId: number, cents: number }[]
  withdrawCents: number
}

/** What settling a deleted bill by hand takes: everyone tops up to their full share, then the bill amount is withdrawn. */
export function settlement(bill: { amountCents: number, participants: (Share & { paidAt: string | Date | null })[], credit?: CreditLike | null }): Settlement {
  const deposits = bill.participants.map(p => ({ userId: p.userId, cents: p.paidAt ? shareDue(p, bill.credit) : null }))
  return {
    deposits,
    receivedCents: deposits.reduce((sum, d) => sum + (d.cents ?? 0), 0),
    creditCents: bill.credit?.amountCents ?? 0,
    adds: bill.participants.map((p, i) => ({ userId: p.userId, cents: p.amountCents - (deposits[i]!.cents ?? 0) })).filter(a => a.cents > 0),
    withdrawCents: bill.amountCents
  }
}
