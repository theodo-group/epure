// Runtime bridge detection. The SAME static bundle ships to GitHub Pages and to
// the local `epure` server, so whether a bridge is present must be decided at
// runtime, never by a build flag. `bridge()` is the ONE synchronous signal:
// App.tsx's bootstrap (skip localStorage, wait for hydrate) and useBridge's
// connection decision both key off it, so they can never disagree.
//
// Two kinds of host can own the page, each with its own signal:
//   - a disk server serves an index.html with `window.__EPURE_BRIDGE__`
//     injected (same-origin, carries the session token): the `ws` transport;
//   - a web page embeds the app (iframe or popup) at `bridgeUrl(...)`: the
//     `pm` transport, spoken over postMessage (see channel.ts).
// GitHub Pages serves the un-injected file with no hash: no signal, standalone.

import { PROTOCOL_VERSION } from './protocol'

declare global {
  interface Window {
    /** Injected by a disk-server host into the served index.html (inject.ts).
     *  Field values are validated here, hence `unknown`. */
    __EPURE_BRIDGE__?: Partial<
      Record<'token' | 'wsUrl' | 'protocol' | 'doc' | 'file' | 'version', unknown>
    >
  }
}

/** What the session shares across transports, plus the transport's own fields. */
export type BridgeConfig = {
  /** Per-session token required on the hello. */
  token: string
  protocol: number
  /** Diagram stem, e.g. `system`. */
  doc: string
} & (
  | {
      transport: 'ws'
      /** WebSocket path, e.g. `/__epure/ws`. */
      wsUrl: string
      /** Absolute realpath of the `.epr.d2` on the server. */
      file: string
      version: string
    }
  | {
      transport: 'pm'
      /** The host page's origin. Both sides filter messages on it. */
      origin: string
    }
)

/** The disk-server signal: the injected global, validated field by field. */
const injected = (): BridgeConfig | null => {
  if (typeof window === 'undefined') return null
  const raw = window.__EPURE_BRIDGE__
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.token !== 'string' || raw.token.length === 0) return null
  if (typeof raw.wsUrl !== 'string') return null
  return {
    transport: 'ws',
    token: raw.token,
    wsUrl: raw.wsUrl,
    protocol: typeof raw.protocol === 'number' ? raw.protocol : PROTOCOL_VERSION,
    doc: typeof raw.doc === 'string' ? raw.doc : '',
    file: typeof raw.file === 'string' ? raw.file : '',
    version: typeof raw.version === 'string' ? raw.version : '',
  }
}

/**
 * The embedding-page signal: `#bridge=pm&origin=...&token=...[&doc=...]`. Only
 * honored when a host window actually exists (opener or embedding parent). The
 * same static bundle opened directly with a stale hash must fall back to
 * standalone mode, not wait forever for a hydrate that can't come.
 */
const hashed = (): BridgeConfig | null => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (params.get('bridge') !== 'pm') return null
  const token = params.get('token') ?? ''
  const origin = params.get('origin') ?? ''
  if (token.length === 0 || !/^https?:\/\//.test(origin)) return null
  if (!window.opener && window.parent === window) return null
  return {
    transport: 'pm',
    token,
    protocol: PROTOCOL_VERSION,
    doc: params.get('doc') ?? '',
    origin,
  }
}

/**
 * The bridge this page runs under, or null (standalone). A disk server's
 * injected global is authoritative over any leftover pm hash: it is same-origin
 * and could only have been placed there by the host serving this very HTML.
 */
export const bridge = (): BridgeConfig | null => injected() ?? hashed()

/**
 * The URL a host page points its iframe (or popup) at to embed the editor
 * bridged: `bridgeUrl(app, { origin: location.origin, token, doc })`. Parsed
 * back by `bridge()` on boot, so the hash format lives in this file only.
 */
export const bridgeUrl = (
  app: string,
  session: { origin: string; token: string; doc: string },
): string => {
  const enc = encodeURIComponent
  return `${app}#bridge=pm&origin=${enc(session.origin)}&token=${enc(session.token)}&doc=${enc(session.doc)}`
}

/** Build the absolute WebSocket URL from the page origin + the config's path. */
export const wsEndpoint = (config: Extract<BridgeConfig, { transport: 'ws' }>): string => {
  if (typeof window === 'undefined') return config.wsUrl
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${config.wsUrl}`
}
