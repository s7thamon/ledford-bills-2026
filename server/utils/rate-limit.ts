import { createError } from 'h3'

// shortcut: in-memory counters, fine for one Node process; move to Redis/DB if the app runs multiple instances.
const hits = new Map<string, { count: number, resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count++
  if (entry.count > max) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please wait a few minutes and try again.' })
  }
}

export function clearRateLimits(): void {
  hits.clear()
}
