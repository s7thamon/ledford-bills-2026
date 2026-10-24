/** Equal share, rounded up so the shared account is never short. */
export function equalShare(totalCents: number, people: number): number {
  return people > 0 ? Math.ceil(totalCents / people) : 0
}

/**
 * Split a total across users. With `locked`, that user pays the locked amount (clamped to the total)
 * and everyone else splits the remainder, still rounding up.
 */
export function splitAmounts(
  totalCents: number,
  userIds: number[],
  locked?: { userId: number, amountCents: number }
): Record<number, number> {
  const result: Record<number, number> = {}
  if (!locked || !userIds.includes(locked.userId)) {
    const share = equalShare(totalCents, userIds.length)
    for (const id of userIds) result[id] = share
    return result
  }
  const lockedAmount = Math.max(0, Math.min(locked.amountCents, totalCents))
  const others = userIds.filter(id => id !== locked.userId)
  const share = equalShare(totalCents - lockedAmount, others.length)
  for (const id of userIds) result[id] = id === locked.userId ? lockedAmount : share
  return result
}

export function isCustomSplit(amounts: number[]): boolean {
  return new Set(amounts).size > 1
}
