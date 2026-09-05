// postMessage transport for the bridge. Lets the SAME static bundle (GitHub
// Pages, `vite dev`) run bridged when a host *page*, rather than a disk
// server, owns the pair: the host embeds the app (iframe or popup) at
// `bridgeUrl(...)` and plays the server role of the wire protocol over
// `window.postMessage`. On the wire a frame stays the exact JSON string the
// WebSocket transport speaks, inside a one-key envelope so bridge traffic can
// never be confused with other postMessage on the page. Hosts never touch the
// envelope: they `unwrap(event.data)` in and `postMessage(wrap(msg))` out.

import type { SocketLike } from './BridgeClient'
import type { BridgeMsg } from './protocol'

const ENVELOPE = 'epureBridge'

/** What the transport needs from the host window. */
type Host = Pick<Window, 'postMessage'>

/** The window that opened or embeds this page: the bridge host, if any. */
export const host = (): Host | null => {
  if (typeof window === 'undefined') return null
  const opener: Host | null = window.opener ?? null
  if (opener) return opener
  if (window.parent !== window) return window.parent
  return null
}

const frameOf = (data: unknown): string | null => {
  if (typeof data !== 'object' || data === null || !(ENVELOPE in data)) return null
  const frame = data[ENVELOPE]
  return typeof frame === 'string' ? frame : null
}

/** Seal a message for `postMessage`. The other side `unwrap`s it. */
export const wrap = (msg: BridgeMsg): Record<typeof ENVELOPE, string> => ({
  [ENVELOPE]: JSON.stringify(msg),
})

/**
 * Read a bridge message out of a postMessage payload; null when the payload is
 * not bridge traffic. Checks the envelope and the message `type`; field shapes
 * are the protocol's word, made trustworthy by the origin/source pinning both
 * sides enforce.
 */
export const unwrap = (data: unknown): BridgeMsg | null => {
  const frame = frameOf(data)
  if (frame === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(frame)
  } catch {
    return null
  }
  return isMsg(parsed) ? parsed : null
}

const TYPES: ReadonlySet<string> = new Set<BridgeMsg['type']>([
  'hello',
  'apply',
  'hydrate',
  'fileChanged',
  'applied',
  'rejected',
])

const isMsg = (value: unknown): value is BridgeMsg =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string' &&
  TYPES.has(value.type)

/**
 * A `SocketLike` over `host().postMessage`: BridgeClient's pm transport. The
 * host window and its origin pin the channel; both sides drop any message
 * whose origin or source doesn't match. "open" fires on the next tick (after
 * BridgeClient has assigned its handlers), mirroring a WebSocket. A vanished
 * host surfaces as an immediate close, which hands control to BridgeClient's
 * normal backoff.
 */
export const channel = (origin: string): SocketLike => {
  const peer = host()
  let closed = false
  const socket: SocketLike = {
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    send: (data) => peer?.postMessage({ [ENVELOPE]: data }, origin),
    close: () => {
      if (closed) return
      closed = true
      window.removeEventListener('message', onMessage)
    },
  }
  const onMessage = (ev: MessageEvent) => {
    if (closed || ev.origin !== origin || ev.source !== peer) return
    const frame = frameOf(ev.data)
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
