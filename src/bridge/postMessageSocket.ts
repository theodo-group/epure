// postMessage transport for the bridge. Lets the SAME static bundle (GitHub
// Pages, `vite dev`) run bridged when a host *page* — rather than a disk
// server — owns the pair: the host embeds the app in an iframe (or opens it as
// a popup) with `#bridge=pm&origin=<host>&token=<t>` and plays the server role
// of the wire protocol over `window.postMessage`. Frames are the exact JSON
// strings BridgeClient already speaks, wrapped in a marker envelope so bridge
// traffic can never be confused with other postMessage on the page.

import type { SocketFactory, SocketLike } from './BridgeClient'

/** Envelope shape in both directions: `{ [PM_ENVELOPE_KEY]: '<frame json>' }`. */
export const PM_ENVELOPE_KEY = 'epureBridge'

/** Unwrap a bridge frame from a postMessage payload; null when it's not ours. */
export const readPmFrame = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null
  const frame = (data as Record<string, unknown>)[PM_ENVELOPE_KEY]
  return typeof frame === 'string' ? frame : null
}

/** The window that opened or embeds this page — the bridge host, if any. */
export const peerWindow = (): Window | null => {
  if (typeof window === 'undefined') return null
  if (window.opener) return window.opener as Window
  if (window.parent !== window) return window.parent
  return null
}

/**
 * A `SocketLike` over `peer.postMessage`. The `url` argument the factory
 * receives is ignored — the peer window and its origin pin the transport, and
 * both sides drop any message whose origin/source doesn't match. "open" fires
 * on the next tick (after BridgeClient has assigned its handlers), mirroring a
 * WebSocket; a vanished peer surfaces as an immediate close, which hands
 * control to BridgeClient's normal backoff.
 */
export const makePmSocketFactory =
  (peerOrigin: string): SocketFactory =>
  () => {
    const peer = peerWindow()
    let closed = false
    const socket: SocketLike = {
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null,
      send: (data) => peer?.postMessage({ [PM_ENVELOPE_KEY]: data }, peerOrigin),
      close: () => {
        if (closed) return
        closed = true
        window.removeEventListener('message', onMessage)
      },
    }
    const onMessage = (ev: MessageEvent) => {
      if (closed || ev.origin !== peerOrigin || ev.source !== peer) return
      const frame = readPmFrame(ev.data)
      if (frame !== null) socket.onmessage?.({ data: frame })
    }
    window.addEventListener('message', onMessage)
    setTimeout(() => {
      if (closed) return
      if (peer) socket.onopen?.()
      else socket.onclose?.()
    }, 0)
    return socket
  }
