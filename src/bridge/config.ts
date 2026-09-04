// Runtime bridge detection. The SAME static bundle ships to GitHub Pages and to
// the local `epure` server — so whether a bridge is present must be decided at
// runtime, never by a build flag.
//
// The signal is the `window.__EPURE_BRIDGE__` global the bridge host injects
// into the served index.html (carrying the per-session token). GitHub Pages
// serves the un-injected index.html, so the global is simply absent there →
// `detectBridge()` resolves null and the app runs in its normal localStorage
// mode. We additionally confirm against `GET /__epure/config` so a stale/forged
// global can't make the app think it's bridged when the endpoint disagrees.

import { PROTOCOL_VERSION } from './protocol'

export interface BridgeConfig {
  /** Per-session token required on the WS hello. */
  token: string
  /** WebSocket path, e.g. `/__epure/ws`. Empty for the postMessage transport. */
  wsUrl: string
  protocol: number
  /** Diagram stem, e.g. `system`. */
  doc: string
  /** Absolute realpath of the `.epr.d2` on the server. */
  file: string
  version: string
  /** Wire transport. Absent means WebSocket (the disk-server hosts). */
  transport?: 'ws' | 'pm'
  /** postMessage only: the host page's origin — both sides filter on it. */
  peerOrigin?: string
}

interface InjectedBridge {
  token?: unknown
  wsUrl?: unknown
  protocol?: unknown
  doc?: unknown
  file?: unknown
  version?: unknown
}

const asConfig = (raw: InjectedBridge | undefined): BridgeConfig | null => {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.token !== 'string' || raw.token.length === 0) return null
  if (typeof raw.wsUrl !== 'string') return null
  return {
    token: raw.token,
    wsUrl: raw.wsUrl,
    protocol: typeof raw.protocol === 'number' ? raw.protocol : PROTOCOL_VERSION,
    doc: typeof raw.doc === 'string' ? raw.doc : '',
    file: typeof raw.file === 'string' ? raw.file : '',
    version: typeof raw.version === 'string' ? raw.version : '',
  }
}

/** Read the host-injected bridge global synchronously (no I/O). */
export const readInjectedBridge = (): BridgeConfig | null => {
  if (typeof window === 'undefined') return null
  return asConfig((window as { __EPURE_BRIDGE__?: InjectedBridge }).__EPURE_BRIDGE__)
}

/**
 * Read a postMessage-bridge request from the URL hash, synchronously:
 * `#bridge=pm&origin=<host origin>&token=<nonce>[&doc=<stem>]`. Only honored
 * when a host window actually exists (opener or embedding parent) — the same
 * static bundle opened directly with a stale hash must fall back to standalone
 * mode, not wait forever for a hydrate that can't come.
 */
export const readHashBridge = (): BridgeConfig | null => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (params.get('bridge') !== 'pm') return null
  const token = params.get('token') ?? ''
  const peerOrigin = params.get('origin') ?? ''
  if (token.length === 0 || !/^https?:\/\//.test(peerOrigin)) return null
  if (!window.opener && window.parent === window) return null
  return {
    token,
    wsUrl: '',
    protocol: PROTOCOL_VERSION,
    doc: params.get('doc') ?? '',
    file: '',
    version: '',
    transport: 'pm',
    peerOrigin,
  }
}

/**
 * The ONE synchronous bridge signal, shared by App.tsx's bootstrap (skip
 * localStorage, wait for hydrate) and `detectBridge`. Injected global first —
 * a disk-server host is authoritative over any leftover hash.
 */
export const readBridgeSignal = (): BridgeConfig | null =>
  readInjectedBridge() ?? readHashBridge()

/**
 * Decide whether this page is running under a live bridge. Resolves the bridge
 * config (with token) or null.
 *
 * The injected global is the *authoritative* runtime signal: it is same-origin
 * and could only have been placed there by the bridge host serving this HTML
 * (GitHub Pages serves the un-injected file → no global → null). It carries the
 * token, which a bare `/__epure/config` probe cannot. We deliberately do NOT
 * veto a present global on a config-endpoint mismatch: doing so would let the
 * async probe disagree with App.tsx's *synchronous* bootstrap decision (which
 * keys off the same global), blanking the app. Detection and bootstrap must use
 * one signal — this one.
 */
export const detectBridge = async (): Promise<BridgeConfig | null> =>
  readBridgeSignal()

/** Build the absolute WebSocket URL from the page origin + the config's path. */
export const wsEndpoint = (config: BridgeConfig): string => {
  if (typeof window === 'undefined') return config.wsUrl
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${config.wsUrl}`
}
