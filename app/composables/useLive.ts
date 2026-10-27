interface LiveEvent {
  topics: string[]
  message?: string
  actorId?: number
}

const connected = ref(false)
let socket: WebSocket | null = null
let retry = 0
let stopped = false

/** Keeps one WebSocket open; other users' changes refresh matching useFetch keys and show a toast. */
export function useLive() {
  const toast = useToast()
  const { user } = useUserSession()

  function connect() {
    if (socket || stopped) return
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws`
    socket = new WebSocket(url)

    socket.onopen = () => {
      // Catch up on anything missed while disconnected.
      if (retry > 0) refreshNuxtData()
      retry = 0
      connected.value = true
    }
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as LiveEvent
      // "<topic>-badge" keys are the menu badges, which live outside the page that owns the topic.
      refreshNuxtData(event.topics.flatMap(t => [t, `${t}-badge`]))
      if (event.message && event.actorId !== user.value?.id) {
        toast.add({ title: event.message, icon: 'i-lucide-bell', color: 'info' })
      }
    }
    socket.onclose = () => {
      socket = null
      connected.value = false
      if (stopped) return
      retry++
      setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry))
    }
  }

  function disconnect() {
    stopped = true
    socket?.close()
  }

  onMounted(() => {
    stopped = false
    connect()
  })

  return { connected, disconnect }
}
