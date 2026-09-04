// React adapter: wires a BridgeClient to the diagram store and App lifecycle.
//
// Inbound (disk → UI):
//   - first hydrate → loadDocument (fresh baseline, clears undo),
//   - reconnect hydrate / fileChanged → applyRemote (paused, keeps undo),
//   - both deferred behind the interaction guard so a remote write never yanks
//     a node mid-drag or clobbers mid-keystroke editor text.
// Outbound (UI → disk):
//   - subscribe to store source/layout; send the dirty kinds (validity-gated,
//     echo-suppressed by BridgeClient's per-kind last-applied-hash).

import { useCallback, useEffect, useRef, useState } from 'react'

import { useDiagramStore } from '@/store/diagramStore'
import type { LayoutSidecar } from '@/layout/types'
import { validateLayoutJson } from '@/file/layoutSchema'

import { BridgeClient, type BridgeStatus, type SocketFactory } from './BridgeClient'
import { detectBridge } from './config'
import { makePmSocketFactory } from './postMessageSocket'
import { interaction } from './interaction'
import { layoutToText } from './sync'
import {
  docKeyOf,
  readBackup,
  writeBackup,
  reconcile,
  type DocBackup,
} from './offlineBackup'
import type { FileFrame, FileKind } from './protocol'

// Test-only seam: inject a fake WebSocket factory so the hook is drivable in
// jsdom (which has no WebSocket). Unset in production → BridgeClient's default.
let testSocketFactory: SocketFactory | undefined
export const __setTestSocketFactory = (f: SocketFactory | undefined): void => {
  testSocketFactory = f
}

export type BridgeUiStatus = 'standalone' | BridgeStatus

/** Outbound persistence state, surfaced as a status-bar cue.
 *  - `saved`   every local edit is confirmed on disk,
 *  - `saving`  an edit was dispatched, awaiting the server's `applied` ack,
 *  - `unsaved` the buffer is invalid and was withheld from disk,
 *  - `offline` not connected — nothing is reaching disk. */
export type BridgeSaveState = 'saved' | 'saving' | 'unsaved' | 'offline'

/** A genuine conflict: the browser backup and the disk file BOTH changed since
 *  they were last in sync, so the user must pick which to keep. */
export interface ClashInfo {
  /** When the local copy was last saved in the browser (epoch ms). */
  localSavedAt: number
  local: { nodes: number; edges: number }
  disk: { nodes: number; edges: number }
}

export interface BridgeUiState {
  /** True when a live bridge was detected (vs standalone/localStorage mode). */
  active: boolean
  status: BridgeUiStatus
  /** Diagram filename stem, shown when connected. */
  filename: string
  /** Transient flash when a remote edit just landed. */
  flash: boolean
  /** A valid remote change is waiting behind the interaction guard. */
  diskChanged: boolean
  /** The editor buffer is invalid and was NOT written to disk. */
  invalidUnsaved: boolean
  /** Outbound persistence state for the status-bar save cue. */
  saveState: BridgeSaveState
  /** Showing the browser backup because the bridge hasn't hydrated (server
   *  unreachable). Edits are held locally and pushed once it reconnects. */
  usingLocalCopy: boolean
  /** Set when the browser backup and disk genuinely conflict; drives the prompt. */
  clash: ClashInfo | null
  /** Resolve a conflict: keep the local copy (push it to disk) or take disk. */
  resolveClash: (choice: 'local' | 'disk') => void
  /** Disk holds invalid content (CC wrote garbage); UI keeps last-good. */
  remoteError: string | null
}

const FLASH_MS = 1200
const RECONCILE_POLL_MS = 400
// Coalesce outbound disk writes. The editor drives `setSource` on every keystroke
// (and a drag drives `moveNodes` on every grid step), so without this every one
// of those would be its own socket send + disk write + watcher round-trip. We
// send immediately on the first change of a burst (leading edge — keeps the save
// cue and the "busy" guard responsive) and collapse the rest into one trailing
// write once edits go quiet.
const OUTBOUND_DEBOUNCE_MS = 250
// Grace period before falling back to the browser backup when the bridge hasn't
// hydrated (server unreachable). Short enough to avoid a long blank, long enough
// that a healthy connection hydrates first (no flash of the local copy).
const OFFLINE_FALLBACK_MS = 1200

const fallbackLayout = (): LayoutSidecar => ({ gridSize: 40, nodes: {}, edges: {} })

const layoutFromFrame = (content: string | null): LayoutSidecar => {
  if (content === null) return fallbackLayout()
  return validateLayoutJson(content).value ?? fallbackLayout()
}

export const useBridge = (): BridgeUiState => {
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<BridgeUiStatus>('standalone')
  const [filename, setFilename] = useState('')
  const [flash, setFlash] = useState(false)
  const [diskChanged, setDiskChanged] = useState(false)
  const [invalidUnsaved, setInvalidUnsaved] = useState(false)
  // Count of edits sent to disk but not yet confirmed by the server's `applied`.
  // > 0 means "Saving…"; back to 0 means every edit is on disk ("Saved").
  const [pendingWrites, setPendingWrites] = useState(0)
  // A local edit is buffered behind the outbound debounce, not yet dispatched.
  // Also counts as "Saving…" so the cue never says "Saved" with edits in hand.
  const [unsentEdits, setUnsentEdits] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [usingLocalCopy, setUsingLocalCopy] = useState(false)
  const [clash, setClash] = useState<ClashInfo | null>(null)
  // The full conflict payload (kept in a ref so resolveClash can act on it
  // without re-subscribing). `clash` above is the lean UI view of this.
  const clashDataRef = useRef<{ local: DocBackup; disk: { source: string; layout: LayoutSidecar } } | null>(null)
  // Whether a real document is loaded (hydrate or offline backup), gating the
  // backup writer so the empty bootstrap state can never overwrite a good backup.
  const hasDocRef = useRef(false)
  // Per-document backup key (bridge doc stem, falling back to file path).
  const docIdRef = useRef('')

  const clientRef = useRef<BridgeClient | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // True once the authoritative disk state has arrived from the server. Until
  // then the store still holds its empty bootstrap baseline (bridge mode skips
  // the localStorage hydrate), and writing THAT back would clobber the user's
  // file. So no outbound write is allowed before the first hydrate — a slow or
  // failed reconnect can never overwrite good work; the file just waits intact
  // for the hydrate to land.
  const hydratedRef = useRef(false)

  useEffect(() => {
    const { applyRemote } = useDiagramStore.getState()
    const loadDocument = useDiagramStore.getState().loadDocument
    let disposed = false
    let offlineTimer: ReturnType<typeof setTimeout> | undefined
    // Latest deferred remote frame per kind, awaiting a quiet window. Scoped to
    // this effect run (not a ref), so a StrictMode remount can never replay a
    // previous mount's stale "disk changed".
    const pending = new Map<FileKind, string>()

    const triggerFlash = () => {
      setFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS)
    }

    // Apply one validated remote kind to the store via the paused chokepoint.
    // markRemote runs BEFORE the store write: applyRemote's set() fires the
    // outbound subscriber synchronously, so lastKey must already be recorded or
    // the just-applied remote change echoes straight back to disk.
    const applyKind = (kind: FileKind, content: string) => {
      const client = clientRef.current
      if (kind === 'd2') {
        client?.markRemote('d2', content)
        applyRemote({ source: content })
      } else if (kind === 'layout') {
        const value = validateLayoutJson(content).value
        if (!value) return
        client?.markRemote('layout', content)
        applyRemote({ layout: value })
      }
      triggerFlash()
    }

    // Apply now if the user is idle, else stash for the next quiet window.
    const receive = (kind: FileKind, content: string | null, valid: boolean, error?: string) => {
      if (!valid) {
        setRemoteError(error ?? 'disk file is invalid')
        return
      }
      setRemoteError(null)
      if (content === null) {
        // File deleted — keep the last good buffer in the store.
        return
      }
      if (interaction.isBusy()) {
        pending.set(kind, content)
        setDiskChanged(true)
        return
      }
      applyKind(kind, content)
    }

    const flushPending = () => {
      if (pending.size === 0 || interaction.isBusy()) return
      for (const [kind, content] of pending) applyKind(kind, content)
      pending.clear()
      setDiskChanged(false)
    }

    // Push the store's current state to disk, mirroring the outbound subscriber's
    // send + save-cue bookkeeping. Used on reconnect when the local copy holds
    // edits that never reached the socket (they were made while it was down): the
    // store won't change, so nothing re-fires the subscriber — without this the
    // work would sit unsaved on disk until the next edit.
    const flushLocal = () => {
      const client = clientRef.current
      if (!client) return
      const state = useDiagramStore.getState()
      const { sent, invalid } = client.apply([
        { kind: 'd2', content: state.source },
        { kind: 'layout', content: layoutToText(state.layout) },
      ])
      if (sent.length > 0) setPendingWrites((n) => n + 1)
      setInvalidUnsaved(invalid.includes('d2'))
    }

    void detectBridge().then((config) => {
      if (disposed || !config) {
        setStatus('standalone')
        return
      }
      setActive(true)
      setFilename(config.doc)
      const docId = config.doc || config.file || 'default'
      docIdRef.current = docId

      const client = new BridgeClient({
        config,
        ...(testSocketFactory
          ? { socketFactory: testSocketFactory }
          : config.transport === 'pm' && config.peerOrigin
            ? { socketFactory: makePmSocketFactory(config.peerOrigin) }
            : {}),
        onStatus: (s) => {
          setStatus(s)
          if (s === 'disconnected') {
            // In-flight writes are unknowable once the socket drops; the badge
            // shows "offline" until reconnect, so clear the pending count.
            setPendingWrites(0)
          }
        },
        onApplied: () => {
          setInvalidUnsaved(false)
          // One envelope confirmed written to disk.
          setPendingWrites((n) => Math.max(0, n - 1))
        },
        onRejected: (reason, err) => {
          // A rejected envelope is no longer in flight (it errored, not saved).
          setPendingWrites((n) => Math.max(0, n - 1))
          if (reason === 'unauthorized') setStatus('disconnected')
          else if (reason === 'invalid') setRemoteError(err ?? 'rejected')
        },
        onHydrate: (files: FileFrame[], reconnect: boolean) => {
          const byKind = Object.fromEntries(files.map((f) => [f.kind, f]))
          const source = byKind.d2?.content ?? ''
          const layout = layoutFromFrame(byKind.layout?.content ?? null)
          // Key against the *store-resulting* content BEFORE the store write, so
          // the synchronous outbound subscriber dedups. Critical for an absent
          // layout file, where the store holds a synthesized default that must
          // NOT be written straight back to disk (it would create a spurious
          // layout.json the user never asked for).
          client.markRemote('d2', source)
          client.markRemote('layout', layoutToText(layout))
          // The disk baseline is now in hand — outbound writes are safe.
          hydratedRef.current = true
          hasDocRef.current = true
          setUsingLocalCopy(false)

          // 3-way reconcile against the browser backup (see offlineBackup).
          const diskKey = docKeyOf(source, layout)
          const backup = readBackup(docId)
          const localKey = backup ? docKeyOf(backup.source, backup.layout) : null
          const action = reconcile(diskKey, localKey, backup?.base ?? null)

          if (action === 'clash' && backup) {
            // Genuine conflict — show the user's own copy and prompt for a choice.
            clashDataRef.current = { local: backup, disk: { source, layout } }
            setClash({
              localSavedAt: backup.savedAt,
              local: {
                nodes: Object.keys(backup.layout.nodes).length,
                edges: Object.keys(backup.layout.edges).length,
              },
              disk: {
                nodes: Object.keys(layout.nodes).length,
                edges: Object.keys(layout.edges).length,
              },
            })
            if (!reconnect) loadDocument(backup.source, backup.layout)
            // reconnect: the store already holds the local edits — leave them.
            return
          }

          setClash(null)
          clashDataRef.current = null

          if (action === 'keep-local' && backup) {
            // Disk unchanged since sync; the local copy has the only edits.
            if (!reconnect) {
              // First load: restore the local copy — the store write fires the
              // outbound subscriber, which pushes it to disk.
              loadDocument(backup.source, backup.layout)
            } else {
              // Reconnect: the store already holds these edits, so no store write
              // fires — and they were never sent (the socket was down when they
              // were made). Push the current state now, or a brief disconnect
              // would strand unsaved work until the next edit.
              flushLocal()
            }
            return
          }

          // take-disk: disk wins (identical, or local had no edits beyond base).
          if (!reconnect) {
            loadDocument(source, layout) // first load: fresh baseline
            return
          }
          // Reconnect applies disk via the paused path (never wipes history) — but
          // honors the interaction guard so a socket blip mid-drag doesn't yank
          // the canvas. Defer to the next quiet window.
          if (interaction.isBusy()) {
            if (byKind.d2?.content != null) pending.set('d2', source)
            pending.set('layout', layoutToText(layout))
            setDiskChanged(true)
            return
          }
          applyRemote({ source, layout })
          triggerFlash()
        },
        onFileChanged: receive,
      })
      clientRef.current = client
      client.connect()

      // Offline fallback: if no hydrate arrives (server down), show the browser
      // backup instead of a blank canvas. Edits are held locally (the outbound
      // guard blocks disk writes until hydrate) and reconciled on reconnect.
      offlineTimer = setTimeout(() => {
        if (disposed || hydratedRef.current) return
        const backup = readBackup(docId)
        if (!backup) return
        hasDocRef.current = true
        setUsingLocalCopy(true)
        loadDocument(backup.source, backup.layout)
      }, OFFLINE_FALLBACK_MS)
    })

    // Pointer + reconcile wiring.
    const onPointerDown = () => interaction.setPointerDown(true)
    const onPointerUp = () => interaction.setPointerDown(false)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    const unsubReconcile = interaction.subscribe(flushPending)
    const pollTimer = setInterval(flushPending, RECONCILE_POLL_MS)

    return () => {
      disposed = true
      clientRef.current?.close()
      clientRef.current = null
      // `pending` is scoped to this effect run, so it's discarded with the
      // closure — nothing to clear. Just reset the pill the next mount re-derives.
      setDiskChanged(false)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      unsubReconcile()
      clearInterval(pollTimer)
      if (offlineTimer) clearTimeout(offlineTimer)
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  // Outbound: any local source/layout change is sent (dirty kinds only),
  // debounced so a keystroke/drag burst collapses to a couple of writes.
  useEffect(() => {
    if (!active) return
    let sendTimer: ReturnType<typeof setTimeout> | undefined
    let trailing = false

    // Push the store's current state to disk. Validity-gated and echo-suppressed
    // by the client's per-kind lastKey, so a remote echo dedups to nothing here
    // (sent === invalid === []) and never bounces back out. Returns whether this
    // was a real local edit (a send or an invalid-withhold) vs an echo/no-op —
    // only a real edit opens the debounce window.
    const flush = (): boolean => {
      const client = clientRef.current
      if (!client) return false
      const state = useDiagramStore.getState()
      const { sent, invalid } = client.apply([
        { kind: 'd2', content: state.source },
        { kind: 'layout', content: layoutToText(state.layout) },
      ])
      const real = sent.length > 0 || invalid.length > 0
      // Only a real edit counts as "user activity" (an echo must not mark busy).
      if (real) interaction.noteActivity()
      // A dispatched envelope is now awaiting the server's `applied` ack.
      if (sent.length > 0) setPendingWrites((n) => n + 1)
      setInvalidUnsaved(invalid.includes('d2'))
      setUnsentEdits(false)
      return real
    }

    const arm = () => {
      if (sendTimer) clearTimeout(sendTimer)
      sendTimer = setTimeout(() => {
        sendTimer = undefined
        if (trailing) {
          trailing = false
          flush()
        }
      }, OUTBOUND_DEBOUNCE_MS)
    }

    const unsub = useDiagramStore.subscribe((state, prev) => {
      if (state.source === prev.source && state.layout === prev.layout) return
      // Never write before the first hydrate — the store could still be the empty
      // bootstrap baseline, and writing it would clobber the user's file on a
      // slow/failed reconnect.
      if (!hydratedRef.current) return
      if (!sendTimer) {
        // Leading edge: ship at once so the cue + busy-guard stay responsive.
        // A no-op/echo (e.g. the hydrate's own store write) must NOT open the
        // window, or the next real edit would be misfiled as a trailing send.
        if (flush()) arm()
      } else {
        // Mid-burst: buffer the latest; the trailing send fires once quiet.
        trailing = true
        setUnsentEdits(true)
        arm()
      }
    })
    return () => {
      unsub()
      if (sendTimer) clearTimeout(sendTimer)
    }
  }, [active])

  // Mirror the current doc to the per-document browser backup on every change, so
  // a dead server or a reload never loses work. Runs once a real doc is loaded
  // (hasDocRef), including while offline. The `base` is the disk state we're
  // synced to (the client's last-sent/received key), preserved from the prior
  // backup while offline — this is what lets the reconcile tell a real conflict
  // from a stale copy.
  useEffect(() => {
    if (!active) return
    const unsub = useDiagramStore.subscribe((state, prev) => {
      if (state.source === prev.source && state.layout === prev.layout) return
      if (!hasDocRef.current) return
      const docId = docIdRef.current
      if (!docId) return
      const base = clientRef.current?.getSyncedKey() ?? readBackup(docId)?.base ?? null
      writeBackup(docId, {
        source: state.source,
        layout: state.layout,
        base,
        savedAt: Date.now(),
      })
    })
    return unsub
  }, [active])

  const resolveClash = useCallback((choice: 'local' | 'disk') => {
    const data = clashDataRef.current
    if (!data) return
    const loadDocument = useDiagramStore.getState().loadDocument
    // Loading the chosen doc fires the outbound + backup subscribers synchronously:
    //   - 'local' differs from the disk key markRemote recorded → it's pushed to
    //     disk and the backup re-bases onto it;
    //   - 'disk' matches that key → nothing is sent, the backup re-bases onto disk.
    // Either way the conflict is resolved and the new base is recorded for us.
    if (choice === 'local') loadDocument(data.local.source, data.local.layout)
    else loadDocument(data.disk.source, data.disk.layout)
    clashDataRef.current = null
    setClash(null)
    setUsingLocalCopy(false)
  }, [])

  // Outbound save status for the status-bar cue. Only meaningful while connected;
  // disconnected → 'offline' (nothing is reaching disk).
  const saveState: BridgeSaveState =
    status !== 'connected'
      ? 'offline'
      : invalidUnsaved
        ? 'unsaved'
        : pendingWrites > 0 || unsentEdits
          ? 'saving'
          : 'saved'

  return {
    active,
    status,
    filename,
    flash,
    diskChanged,
    invalidUnsaved,
    saveState,
    usingLocalCopy,
    clash,
    resolveClash,
    remoteError,
  }
}
