// React adapter: wires a BridgeClient to the diagram store and App lifecycle.
//
// Inbound (disk → UI):
//   - hydrate → whatever `planHydrate` decides (load, apply, defer, push the
//     local copy, or raise a clash); this hook only runs the plan,
//   - fileChanged → applyRemote (paused, keeps undo),
//   - both deferred behind the interaction guard so a remote write never yanks
//     a node mid-drag or clobbers mid-keystroke editor text; a deferred change
//     settles once the user is idle, as `planSettle` decides (apply, or a clash
//     when the user edited the same kind meanwhile).
// Outbound (UI → disk):
//   - subscribe to store source/layout; send the dirty kinds (validity-gated,
//     echo-suppressed by BridgeClient's per-kind last-applied-hash),
//   - held: a kind with a deferred disk change isn't sent until it settles, and
//     nothing is sent while a clash prompt is open.

import { useCallback, useEffect, useRef, useState } from 'react'

import { useDiagramStore } from '@/store/diagramStore'
import { validateLayoutJson } from '@/file/layoutSchema'

import { BridgeClient, type BridgeStatus, type SocketFactory } from './BridgeClient'
import { bridge } from './config'
import {
  type Clash,
  type ClashInfo,
  type HeldChange,
  clashInfo,
  planHydrate,
  planSettle,
  textOf,
  withDiskChange,
} from './hydratePlan'
import { interaction } from './interaction'
import { contentKey, layoutToText } from './sync'
import { readBackup, writeBackup } from './offlineBackup'
import type { FileFrame, FileKind } from './protocol'

export type { ClashInfo } from './hydratePlan'

export type BridgeUiStatus = 'standalone' | BridgeStatus

/** Outbound persistence state, surfaced as a status-bar cue.
 *  - `saved`   every local edit is confirmed on disk,
 *  - `saving`  an edit was dispatched, awaiting the server's `applied` ack,
 *  - `unsaved` local content is withheld from disk: the buffer is invalid, or
 *              a clash is waiting for the user's choice,
 *  - `offline` not connected — nothing is reaching disk. */
export type BridgeSaveState = 'saved' | 'saving' | 'unsaved' | 'offline'

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
  /** Set when local and disk genuinely conflict; drives the prompt. */
  clash: ClashInfo | null
  /** Resolve a conflict: keep the local copy (push it to disk) or take disk. */
  resolveClash: (choice: 'local' | 'disk') => void
  /** Disk holds invalid content (CC wrote garbage); UI keeps last-good. */
  remoteError: string | null
}

export interface BridgeOptions {
  /** Opens the transport. Defaults to the one the bridge config names
   *  (WebSocket or postMessage); tests pass a fake. Read once, on mount. */
  socketFactory?: SocketFactory
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

const NO_KINDS: ReadonlySet<FileKind> = new Set()
const ALL_KINDS: ReadonlySet<FileKind> = new Set(['d2', 'layout'])

/** The kinds the outbound path must not send: all of them while a clash is
 *  open, else those with a deferred disk change still to settle. */
const heldKinds = (clash: Clash | null, pending: Map<FileKind, HeldChange>) =>
  clash ? ALL_KINDS : pending.size > 0 ? new Set(pending.keys()) : NO_KINDS

/** Offer the store's current content to the client, which sends the kinds that
 *  are valid and changed (see `BridgeClient.apply`). A held kind is only
 *  validated; `heldDirty` lists the held kinds with edits waiting on them. */
const sendStore = (client: BridgeClient, held: ReadonlySet<FileKind> = NO_KINDS) => {
  const state = useDiagramStore.getState()
  const files: { kind: FileKind; content: string }[] = [
    { kind: 'd2', content: state.source },
    { kind: 'layout', content: layoutToText(state.layout) },
  ]
  const result = client.apply(files.filter((f) => !held.has(f.kind)))
  const invalid = [...result.invalid]
  const heldDirty: FileKind[] = []
  for (const file of files) {
    if (!held.has(file.kind)) continue
    const key = contentKey(file.kind, file.content)
    if (key === null) invalid.push(file.kind)
    if (key === null || key !== client.syncedKeyOf(file.kind)) heldDirty.push(file.kind)
  }
  return { sent: result.sent, invalid, heldDirty }
}

/** Mirror the store to the document's browser backup. The `base` is the disk
 *  state we're synced to (the client's last-sent/received key), preserved from
 *  the prior backup while offline. */
const backupStore = (docId: string, client: BridgeClient | null) => {
  const state = useDiagramStore.getState()
  const base = client?.getSyncedKey() ?? readBackup(docId)?.base ?? null
  writeBackup(docId, { source: state.source, layout: state.layout, base, savedAt: Date.now() })
}

export const useBridge = ({ socketFactory }: BridgeOptions = {}): BridgeUiState => {
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
  // The full conflict payload (kept in a ref so the outbound path and
  // resolveClash can act on it without re-subscribing). `clash` above is the
  // lean UI view of this. Non-null holds every outbound write.
  const clashDataRef = useRef<Clash | null>(null)
  // Disk changes deferred behind the interaction guard, per kind. The connection
  // effect owns the map (a fresh one per run); the outbound path reads it to
  // hold those kinds.
  const pendingRef = useRef(new Map<FileKind, HeldChange>())
  // Set by the connection effect: resolve the open clash with the user's choice.
  const resolveRef = useRef<(choice: 'local' | 'disk') => void>(() => {})
  // Whether a real document is loaded (hydrate or offline backup), gating the
  // backup writer so the empty bootstrap state can never overwrite a good backup.
  const hasDocRef = useRef(false)
  // Per-document backup key (bridge doc stem, falling back to file path).
  const docIdRef = useRef('')
  const socketFactoryRef = useRef(socketFactory)

  const clientRef = useRef<BridgeClient | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // True once the authoritative disk state has arrived from the server. Until
  // then the store still holds its empty bootstrap baseline (bridge mode skips
  // the localStorage hydrate), and writing THAT back would clobber the user's
  // file. So no outbound write is allowed before the first hydrate — a slow or
  // failed reconnect can never overwrite good work; the file just waits intact
  // for the hydrate to land.
  const hydratedRef = useRef(false)

  // Pointer state feeds the interaction guard: a pointer held down may be a drag.
  useEffect(() => {
    const onPointerDown = () => interaction.setPointerDown(true)
    const onPointerUp = () => interaction.setPointerDown(false)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  // Connection + inbound: the client's lifecycle and everything disk → store.
  useEffect(() => {
    const config = bridge()
    if (!config) return // standalone: the initial state already says so
    setActive(true)
    setFilename(config.doc)
    // Per-document backup key: the doc stem, then the disk path (ws only).
    const docId = config.doc || (config.transport === 'ws' ? config.file : '') || 'default'
    docIdRef.current = docId

    const { applyRemote, loadDocument } = useDiagramStore.getState()
    // Latest deferred remote content per kind, awaiting a quiet window. Scoped
    // to this effect run, so a StrictMode remount can never replay a previous
    // mount's stale "disk changed".
    const pending = new Map<FileKind, HeldChange>()
    pendingRef.current = pending

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
      if (kind === 'd2') {
        client.markRemote('d2', content)
        applyRemote({ source: content })
      } else if (kind === 'layout') {
        const value = validateLayoutJson(content).value
        if (!value) return
        client.markRemote('layout', content)
        applyRemote({ layout: value })
      }
      triggerFlash()
    }

    // Send the store's content now, outside the debounce (a push the store
    // isn't changing for).
    const pushStore = () => {
      const { sent, invalid } = sendStore(client, heldKinds(clashDataRef.current, pending))
      if (sent.length > 0) setPendingWrites((n) => n + 1)
      setInvalidUnsaved(invalid.includes('d2'))
    }

    const raiseClash = (next: Clash) => {
      clashDataRef.current = next
      setClash(clashInfo(next))
    }

    const clearClash = () => {
      clashDataRef.current = null
      setClash(null)
    }

    // Hold a disk change until the user goes quiet. The base is what the kind
    // was synced with when the FIRST held change arrived (the client keeps it
    // until the change is applied); a later change only replaces the content.
    const defer = (kind: FileKind, content: string) => {
      const base = pending.get(kind)?.base ?? client.syncedKeyOf(kind)
      pending.set(kind, { kind, content, base })
      setDiskChanged(true)
    }

    // Settle the held changes once the user is idle (see `planSettle`).
    const settle = () => {
      if (pending.size === 0 || clashDataRef.current || interaction.isBusy()) return
      const { source, layout } = useDiagramStore.getState()
      const actions = planSettle({
        held: [...pending.values()],
        local: { source, layout },
        now: Date.now(),
      })
      pending.clear()
      setDiskChanged(false)
      for (const action of actions) {
        switch (action.type) {
          case 'raise-clash':
            // Disk now holds the clashing kinds' new content: "Keep my
            // version" must send local over it.
            for (const kind of action.clash.kinds) {
              client.markRemote(kind, textOf(action.clash.disk, kind))
            }
            raiseClash(action.clash)
            break
          case 'apply':
            applyKind(action.kind, action.content)
            break
          case 'push-local':
            pushStore()
            break
        }
      }
    }

    // Apply now if the user is idle, else stash for the next quiet window.
    const onFileChanged = (
      kind: FileKind,
      content: string | null,
      valid: boolean,
      error?: string,
    ) => {
      if (!valid) {
        setRemoteError(error ?? 'disk file is invalid')
        return
      }
      setRemoteError(null)
      if (content === null) return // file deleted: keep the last good buffer
      const open = clashDataRef.current
      if (open) {
        // The prompt's disk side moves on; the store and disk stay untouched
        // until the user chooses.
        client.markRemote(kind, content)
        raiseClash(withDiskChange(open, kind, content))
      } else if (interaction.isBusy() || pending.size > 0) {
        defer(kind, content)
        settle()
      } else applyKind(kind, content)
    }

    const onHydrate = (files: FileFrame[], reconnect: boolean) => {
      const plan = planHydrate({
        files,
        reconnect,
        backup: readBackup(docId),
        busy: interaction.isBusy(),
      })
      // A hydrate carries the whole disk state: it supersedes anything held.
      pending.clear()
      setDiskChanged(false)
      const deferred = new Set(
        plan.actions.flatMap((a) => (a.type === 'defer' ? a.files.map((f) => f.kind) : [])),
      )
      // Key against the *store-resulting* content BEFORE any store write, so
      // the synchronous outbound subscriber dedups. Critical for an absent
      // layout file, where the store holds a synthesized default that must
      // NOT be written straight back to disk (it would create a spurious
      // layout.json the user never asked for). A deferred kind keeps its key:
      // the base it settles against.
      if (!deferred.has('d2')) client.markRemote('d2', plan.disk.source)
      if (!deferred.has('layout')) client.markRemote('layout', layoutToText(plan.disk.layout))
      // The disk baseline is now in hand — outbound writes are safe.
      hydratedRef.current = true
      hasDocRef.current = true
      setUsingLocalCopy(false)

      for (const action of plan.actions) {
        switch (action.type) {
          case 'raise-clash':
            raiseClash(action.clash)
            break
          case 'clear-clash':
            clearClash()
            break
          case 'load':
            // A fresh baseline; the store write fires the outbound subscriber,
            // which sends it to disk if it differs from the disk just recorded
            // (unless a clash is open: then it's only shown).
            loadDocument(action.doc.source, action.doc.layout)
            break
          case 'apply':
            applyRemote(action.doc)
            triggerFlash()
            break
          case 'defer':
            for (const file of action.files) defer(file.kind, file.content)
            break
          case 'push-local':
            pushStore()
            break
        }
      }
    }

    resolveRef.current = (choice) => {
      const open = clashDataRef.current
      if (!open) return
      // Release the hold first: the writes below are the resolution.
      clearClash()
      setUsingLocalCopy(false)
      if (choice === 'disk') {
        // Every clashing kind is keyed at its disk content, so taking disk
        // writes nothing back.
        if (open.origin === 'session') {
          for (const kind of open.kinds) applyKind(kind, textOf(open.disk, kind))
        } else loadDocument(open.disk.source, open.disk.layout)
      } else if (open.origin === 'backup') {
        loadDocument(open.local.source, open.local.layout)
      }
      // "local": the store holds the local side, keyed against disk, so this
      // sends it. "disk": sends only edits held on other kinds meanwhile.
      pushStore()
      // Re-base the backup onto the outcome (the store may not have changed).
      backupStore(docId, client)
    }

    const client = new BridgeClient({
      config,
      ...(socketFactoryRef.current ? { socketFactory: socketFactoryRef.current } : {}),
      onStatus: (s) => {
        setStatus(s)
        // In-flight writes are unknowable once the socket drops; the badge
        // shows "offline" until reconnect, so clear the pending count.
        if (s === 'disconnected') setPendingWrites(0)
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
      onHydrate,
      onFileChanged,
    })
    clientRef.current = client
    client.connect()

    // Offline fallback: if no hydrate arrives (server down), show the browser
    // backup instead of a blank canvas. Edits are held locally (the outbound
    // guard blocks disk writes until hydrate) and reconciled on reconnect.
    const offlineTimer = setTimeout(() => {
      if (hydratedRef.current) return
      const backup = readBackup(docId)
      if (!backup) return
      hasDocRef.current = true
      setUsingLocalCopy(true)
      loadDocument(backup.source, backup.layout)
    }, OFFLINE_FALLBACK_MS)

    // Deferred changes settle on pointer-up, or on the poll once typing goes quiet.
    const unsubReconcile = interaction.subscribe(settle)
    const pollTimer = setInterval(settle, RECONCILE_POLL_MS)

    return () => {
      client.close()
      clientRef.current = null
      // `pending` is scoped to this effect run; detach it so the outbound path
      // stops holding its kinds. Just reset the pill the next mount re-derives.
      pendingRef.current = new Map()
      resolveRef.current = () => {}
      setDiskChanged(false)
      unsubReconcile()
      clearInterval(pollTimer)
      clearTimeout(offlineTimer)
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
    // (sent === invalid === []) and never bounces back out; held kinds are
    // never sent. Returns whether this was a real local edit (a send, an
    // invalid-withhold or a held edit) vs an echo/no-op — only a real edit
    // opens the debounce window.
    const flush = (): boolean => {
      const client = clientRef.current
      if (!client) return false
      const held = heldKinds(clashDataRef.current, pendingRef.current)
      const { sent, invalid, heldDirty } = sendStore(client, held)
      const real = sent.length > 0 || invalid.length > 0 || heldDirty.length > 0
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
  // (hasDocRef), including while offline. The `base` is what lets the reconcile
  // tell a real conflict from a stale copy. Paused while a clash is open: the
  // backup is one side of it, and re-basing it onto disk would turn the next
  // load's clash into a silent keep-local.
  useEffect(() => {
    if (!active) return
    const unsub = useDiagramStore.subscribe((state, prev) => {
      if (state.source === prev.source && state.layout === prev.layout) return
      if (!hasDocRef.current || clashDataRef.current) return
      const docId = docIdRef.current
      if (!docId) return
      backupStore(docId, clientRef.current)
    })
    return unsub
  }, [active])

  const resolveClash = useCallback((choice: 'local' | 'disk') => resolveRef.current(choice), [])

  // Outbound save status for the status-bar cue. Only meaningful while connected;
  // disconnected → 'offline' (nothing is reaching disk).
  const saveState: BridgeSaveState =
    status !== 'connected'
      ? 'offline'
      : invalidUnsaved || clash
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
