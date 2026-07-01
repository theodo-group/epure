// Framework-agnostic bridge client: owns the WebSocket lifecycle (connect,
// reconnect/backoff), the hello handshake, inbound dispatch, and outbound
// `apply` with a per-kind last-applied-hash that suppresses echoes and no-ops.
//
// Deliberately DOM-free and socket-injectable so it is unit-testable without a
// browser. The React glue lives in `useBridge`.

import type { BridgeConfig } from './config'
import { wsEndpoint } from './config'
import { contentKey } from './sync'
import {
  PROTOCOL_VERSION,
  type FileFrame,
  type FileKind,
  type ServerMsg,
} from './protocol'

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'

/** Minimal WebSocket surface used here — the browser `WebSocket` satisfies it,
 *  and tests inject a fake. */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
}
export type SocketFactory = (url: string) => SocketLike

export interface BridgeClientCallbacks {
  /** First load vs reconnect distinguished by `reconnect`. */
  onHydrate(files: FileFrame[], reconnect: boolean): void
  onFileChanged(
    kind: FileKind,
    content: string | null,
    valid: boolean,
    error?: string,
  ): void
  onStatus(status: BridgeStatus): void
  onApplied?(kinds: FileKind[]): void
  onRejected?(reason: string, error?: string): void
}

export interface BridgeClientOptions extends BridgeClientCallbacks {
  config: BridgeConfig
  socketFactory?: SocketFactory
  /** Backoff schedule in ms; tests pass `[0]` for instant reconnects. */
  backoffMs?: number[]
}

const defaultFactory: SocketFactory = (url) =>
  new WebSocket(url) as unknown as SocketLike

const DEFAULT_BACKOFF = [400, 800, 1600, 3200, 6400]

export class BridgeClient {
  private readonly opts: BridgeClientOptions
  private readonly factory: SocketFactory
  private readonly backoff: number[]
  private socket: SocketLike | null = null
  private closedByUs = false
  private hydratedOnce = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** Identity of the last content seen per kind (applied out OR received in).
   *  An outbound whose key matches is an echo/no-op and is dropped. */
  private readonly lastKey: Partial<Record<FileKind, string | null>> = {}

  constructor(opts: BridgeClientOptions) {
    this.opts = opts
    this.factory = opts.socketFactory ?? defaultFactory
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF
  }

  connect(): void {
    this.closedByUs = false
    this.open()
  }

  close(): void {
    this.closedByUs = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close()
    this.socket = null
  }

  /**
   * Record that a kind's content now matches what's on disk (the store was just
   * set from a remote hydrate/fileChanged). The next outbound for that kind will
   * dedup against this and not bounce the remote change back out.
   */
  markRemote(kind: FileKind, content: string): void {
    this.lastKey[kind] = contentKey(kind, content)
  }

  /** The doc identity currently in sync with disk — `lastKey.d2` joined with
   *  `lastKey.layout`, matching `docKeyOf(source, layout)` in offlineBackup.
   *  Null until both kinds have been reconciled. Used as the reconcile `base`. */
  getSyncedKey(): string | null {
    const d2 = this.lastKey.d2
    const layout = this.lastKey.layout
    if (d2 == null || layout == null) return null
    return `${d2}\u0000${layout}`
  }

  /**
   * Send the dirty kinds as one coherent apply envelope. Each kind is gated:
   *   - dropped if invalid (kept off disk; surfaced via `invalid`),
   *   - dropped if its key is unchanged (echo / no-op),
   *   - otherwise sent, and its key recorded.
   *
   * `lastKey` (and thus `getSyncedKey`) is updated ONLY when an envelope actually
   * goes out. If the socket is down the edit isn't sent — recording its key would
   * falsely mark it "on disk", poisoning the offline-backup base and the save
   * cue. Withholding the update means the edit is correctly re-evaluated on
   * reconnect.
   */
  apply(files: { kind: FileKind; content: string }[]): {
    sent: FileKind[]
    invalid: FileKind[]
  } {
    const invalid: FileKind[] = []
    const toSend: { kind: FileKind; content: string; key: string }[] = []
    for (const file of files) {
      const key = contentKey(file.kind, file.content)
      if (key === null) {
        invalid.push(file.kind)
        continue
      }
      if (key === this.lastKey[file.kind]) continue // echo / no change
      toSend.push({ ...file, key })
    }
    if (toSend.length === 0 || !this.socket) return { sent: [], invalid }
    this.socket.send(
      JSON.stringify({
        type: 'apply',
        doc: this.opts.config.doc,
        files: toSend.map((f) => ({ kind: f.kind, content: f.content })),
      }),
    )
    for (const f of toSend) this.lastKey[f.kind] = f.key
    return { sent: toSend.map((f) => f.kind), invalid }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private open(): void {
    this.opts.onStatus('connecting')
    let socket: SocketLike
    try {
      socket = this.factory(wsEndpoint(this.opts.config))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
      this.opts.onStatus('connected')
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: this.opts.config.token,
          doc: this.opts.config.doc,
        }),
      )
    }
    socket.onmessage = (ev) => {
      this.handle(typeof ev.data === 'string' ? ev.data : String(ev.data))
    }
    socket.onerror = () => {
      // surfaced via onclose; nothing to do here
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      if (this.closedByUs) return
      this.opts.onStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUs) return
    const delay =
      this.backoff[Math.min(this.reconnectAttempt, this.backoff.length - 1)] ?? 0
    this.reconnectAttempt += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private handle(raw: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    switch (msg.type) {
      case 'hydrate': {
        for (const f of msg.files) {
          if (f.valid && f.content !== null) this.markRemote(f.kind, f.content)
        }
        const reconnect = this.hydratedOnce
        this.hydratedOnce = true
        this.opts.onHydrate(msg.files, reconnect)
        break
      }
      case 'fileChanged': {
        if (msg.valid && msg.content !== null) this.markRemote(msg.kind, msg.content)
        this.opts.onFileChanged(msg.kind, msg.content, msg.valid, msg.error)
        break
      }
      case 'applied':
        this.opts.onApplied?.(msg.kinds)
        break
      case 'rejected':
        // A bad token won't fix itself on retry — stop reconnecting.
        if (msg.reason === 'unauthorized') this.closedByUs = true
        this.opts.onRejected?.(msg.reason, msg.error)
        break
    }
  }
}
