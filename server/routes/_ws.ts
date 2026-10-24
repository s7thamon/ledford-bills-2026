export default defineWebSocketHandler({
  async upgrade(request) {
    await requireUserSession(request)
  },
  open(peer) {
    livePeers.add(peer)
  },
  close(peer) {
    livePeers.delete(peer)
  },
  error(peer) {
    livePeers.delete(peer)
  }
})
