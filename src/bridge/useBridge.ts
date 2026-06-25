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

import { useEffect, useRef, useState } from 'react'

import { useDiagramStore } from '@/store/diagramStore'
import type { LayoutSidecar } from '@/layout/types'
import { validateLayoutJson } from '@/file/layoutSchema'
import { useCommentsStore } from '@/comments/store'
import { parseComments, serializeComments } from '@/comments/serialize'

import { BridgeClient, type BridgeStatus, type SocketFactory } from './BridgeClient'
import { detectBridge } from './config'
import { interaction } from './interaction'
import { layoutToText } from './sync'
import type { FileFrame, FileKind } from './protocol'

// Test-only seam: inject a fake WebSocket factory so the hook is drivable in
// jsdom (which has no WebSocket). Unset in production → BridgeClient's default.
let testSocketFactory: SocketFactory | undefined
export const __setTestSocketFactory = (f: SocketFactory | undefined): void => {
  testSocketFactory = f
}

export type BridgeUiStatus = 'standalone' | BridgeStatus

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
  /** Disk holds invalid content (CC wrote garbage); UI keeps last-good. */
  remoteError: string | null
}

const FLASH_MS = 1200
const RECONCILE_POLL_MS = 400

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
  const [remoteError, setRemoteError] = useState<string | null>(null)

  const clientRef = useRef<BridgeClient | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const { applyRemote } = useDiagramStore.getState()
    const loadDocument = useDiagramStore.getState().loadDocument
    let disposed = false
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
      } else if (kind === 'comments') {
        // Comments live in their own store, never the diagram/undo history.
        client?.markRemote('comments', content)
        useCommentsStore.getState().setComments(parseComments(content))
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
        // File deleted. Comments: clear the list; d2/layout: keep last buffer.
        if (kind === 'comments') useCommentsStore.getState().setComments([])
        return
      }
      // Comments don't touch the canvas/editor, so they never need deferring.
      if (kind !== 'comments' && interaction.isBusy()) {
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

    void detectBridge().then((config) => {
      if (disposed || !config) {
        setStatus('standalone')
        return
      }
      setActive(true)
      setFilename(config.doc)

      const client = new BridgeClient({
        config,
        ...(testSocketFactory ? { socketFactory: testSocketFactory } : {}),
        onStatus: setStatus,
        onApplied: () => setInvalidUnsaved(false),
        onRejected: (reason, err) => {
          if (reason === 'unauthorized') setStatus('disconnected')
          else if (reason === 'invalid') setRemoteError(err ?? 'rejected')
        },
        onHydrate: (files: FileFrame[], reconnect: boolean) => {
          const byKind = Object.fromEntries(files.map((f) => [f.kind, f]))
          const source = byKind.d2?.content ?? ''
          const layout = layoutFromFrame(byKind.layout?.content ?? null)
          // Comments are independent of undo/defer — apply straight away.
          const commentsText = byKind.comments?.content ?? null
          client.markRemote('comments', commentsText ?? serializeComments([]))
          useCommentsStore.getState().setComments(parseComments(commentsText))
          // Key against the *store-resulting* content BEFORE the store write, so
          // the synchronous outbound subscriber dedups. Critical for an absent
          // layout file, where the store holds a synthesized default that must
          // NOT be written straight back to disk (it would create a spurious
          // layout.json the user never asked for).
          client.markRemote('d2', source)
          client.markRemote('layout', layoutToText(layout))
          if (!reconnect) {
            loadDocument(source, layout) // first load: fresh baseline
            return
          }
          // Reconnect re-applies disk state via the paused path (never wipes
          // history) — but still honors the interaction guard so a socket blip
          // mid-drag/edit doesn't yank the canvas. Defer to the next quiet window.
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
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  // Outbound: any local source/layout change is sent (dirty kinds only).
  useEffect(() => {
    if (!active) return
    const unsub = useDiagramStore.subscribe((state, prev) => {
      if (state.source === prev.source && state.layout === prev.layout) return
      const client = clientRef.current
      if (!client) return
      const { sent, invalid } = client.apply([
        { kind: 'd2', content: state.source },
        { kind: 'layout', content: layoutToText(state.layout) },
      ])
      // A real local edit produces a send or an invalid-withhold; a remote echo
      // dedups to nothing. Only the former counts as "user activity".
      if (sent.length > 0 || invalid.length > 0) interaction.noteActivity()
      setInvalidUnsaved(invalid.includes('d2'))
    })
    // Outbound for the comments sidecar (its own store).
    const unsubComments = useCommentsStore.subscribe((state, prev) => {
      if (state.comments === prev.comments) return
      clientRef.current?.apply([
        { kind: 'comments', content: serializeComments(state.comments) },
      ])
    })
    return () => {
      unsub()
      unsubComments()
    }
  }, [active])

  return { active, status, filename, flash, diskChanged, invalidUnsaved, remoteError }
}
