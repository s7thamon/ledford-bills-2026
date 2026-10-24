import type { H3Event } from 'h3'
import type { Peer } from 'crossws'

/** Client data keys to refresh: match the `key` passed to useFetch on the pages. */
export type LiveTopic = 'bills' | 'recurring' | 'reimbursements' | 'users'

export interface LiveEvent {
  topics: LiveTopic[]
  /** Toast shown to everyone except the actor. */
  message?: string
  actorId?: number
}

// shortcut: peers live in this process only; use a pub/sub (Redis) if the app ever runs more than one instance.
export const livePeers = new Set<Peer>()

export function publish(event: LiveEvent): void {
  const payload = JSON.stringify(event)
  for (const peer of livePeers) {
    try {
      peer.send(payload)
    }
    catch {
      livePeers.delete(peer)
    }
  }
}

/** Publish a change made during this request; the actor's name prefixes the message. */
export async function broadcast(event: H3Event, live: Omit<LiveEvent, 'actorId'>): Promise<void> {
  const { user } = await getUserSession(event)
  publish({
    ...live,
    actorId: user?.id,
    message: live.message && user ? `${user.name.split(' ')[0]} ${live.message}` : live.message
  })
}
