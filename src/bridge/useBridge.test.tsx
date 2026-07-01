// Integration test for the React glue: hydrate → store, fileChanged → store via
// the paused chokepoint, and the interaction guard deferring inbound applies.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { useDiagramStore } from '@/store/diagramStore'

import { __setTestSocketFactory, useBridge } from './useBridge'
import { interaction } from './interaction'
import { docKeyOf, writeBackup } from './offlineBackup'
import type { LayoutSidecar } from '@/layout/types'
import type { SocketLike } from './BridgeClient'
import type { ServerMsg } from './protocol'

class FakeSocket implements SocketLike {
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  send(d: string) { this.sent.push(d) }
  close() {}
  open() { this.onopen?.() }
  emit(msg: ServerMsg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

let sockets: FakeSocket[] = []
const lastSocket = () => sockets[sockets.length - 1]!

const D2 = 'a\nb\na -> b\n'
const layoutText = (cx: number) =>
  canonicalizeLayout({ gridSize: 40, nodes: { a: { cx, cy: 2, w: 4, h: 2 } }, edges: {} })

const hydrate = (d2: string, layout: string): ServerMsg => ({
  type: 'hydrate',
  doc: 'sys',
  files: [
    { kind: 'd2', content: d2, valid: true },
    { kind: 'layout', content: layout, valid: true },
  ],
})

// jsdom's localStorage is a no-op in this runner; back it with a real Map so the
// offline-backup paths are exercised.
const installLocalStorage = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
}

beforeEach(() => {
  sockets = []
  interaction._reset()
  installLocalStorage()
  useDiagramStore.getState().loadDocument('', { gridSize: 40, nodes: {}, edges: {} })
  ;(window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__ = {
    token: 'tok', wsUrl: '/__epure/ws', protocol: 1, doc: 'sys', file: '/x', version: '1',
  }
  __setTestSocketFactory(() => {
    const s = new FakeSocket()
    sockets.push(s)
    return s
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ bridge: true }),
    }),
  )
})

afterEach(() => {
  __setTestSocketFactory(undefined)
  vi.unstubAllGlobals()
  delete (window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__
})

// Let detectBridge's async chain resolve and the client connect.
const connect = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    lastSocket().open()
  })
}

describe('useBridge', () => {
  it('hydrates the store on first load and reports connected', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => {
      lastSocket().emit(hydrate(D2, layoutText(2)))
    })
    expect(useDiagramStore.getState().source).toBe(D2)
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2)
    expect(result.current.active).toBe(true)
    expect(result.current.status).toBe('connected')
    expect(result.current.filename).toBe('sys')
  })

  it('applies a remote fileChanged when the user is idle', async () => {
    renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    await act(async () => {
      lastSocket().emit({ type: 'fileChanged', doc: 'sys', kind: 'layout', content: layoutText(8), valid: true })
    })
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(8)
  })

  it('defers an inbound apply while the user is interacting, then reconciles', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    // Pointer is down (a drag may be in flight) → guard is "busy".
    await act(async () => interaction.setPointerDown(true))
    await act(async () => {
      lastSocket().emit({ type: 'fileChanged', doc: 'sys', kind: 'layout', content: layoutText(9), valid: true })
    })
    // Deferred: store unchanged, pill flags a pending disk change.
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2)
    expect(result.current.diskChanged).toBe(true)

    // Pointer-up → reconcile applies the deferred change.
    await act(async () => {
      interaction.setPointerDown(false)
    })
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(9)
    expect(result.current.diskChanged).toBe(false)
  })

  it('does NOT write back a synthesized default when the layout file is absent', async () => {
    renderHook(() => useBridge())
    await connect()
    await act(async () => {
      lastSocket().emit({
        type: 'hydrate',
        doc: 'sys',
        files: [
          { kind: 'd2', content: D2, valid: true },
          { kind: 'layout', content: null, valid: true }, // absent on disk
        ],
      })
    })
    // Store holds a usable default layout...
    expect(useDiagramStore.getState().layout.nodes).toEqual({})
    // ...but nothing was sent back to disk — only the hello frame went out.
    const applies = lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
    expect(applies).toHaveLength(0)
  })

  it('reports saveState saving → saved across an edit and its ack', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    // Nothing pending right after hydrate.
    expect(result.current.saveState).toBe('saved')

    // A local edit is dispatched to disk → awaiting the server's ack.
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 400, 80)
    })
    expect(result.current.saveState).toBe('saving')

    // Server confirms the write → back to saved.
    await act(async () => {
      lastSocket().emit({ type: 'applied', doc: 'sys', kinds: ['layout'] })
    })
    expect(result.current.saveState).toBe('saved')
  })

  const layoutObj = (cx: number): LayoutSidecar => ({
    gridSize: 40,
    nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
    edges: {},
  })

  it('falls back to the browser backup when no hydrate arrives (server down)', async () => {
    writeBackup('sys', { source: D2, layout: layoutObj(7), base: null, savedAt: 1 })
    const { result } = renderHook(() => useBridge())
    await connect() // socket opens, but the server never sends a hydrate
    // Wait out the offline-fallback grace period.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1400))
    })
    expect(result.current.usingLocalCopy).toBe(true)
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(7)
  })

  it('prompts on a genuine clash (local and disk both diverged from base)', async () => {
    // base = layout(5); local = layout(8); disk = layout(2) → all differ.
    writeBackup('sys', { source: D2, layout: layoutObj(8), base: docKeyOf(D2, layoutObj(5)), savedAt: 99 })
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.clash).not.toBeNull()
    expect(result.current.clash?.local.nodes).toBe(1)
    // Resolving with "disk" loads the disk version and clears the prompt.
    await act(async () => result.current.resolveClash('disk'))
    expect(result.current.clash).toBeNull()
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2)
  })

  it('keeps local edits without prompting when only the local copy changed', async () => {
    // base == disk (no external change); local has edits → keep-local, push to disk.
    writeBackup('sys', { source: D2, layout: layoutObj(8), base: docKeyOf(D2, layoutObj(2)), savedAt: 7 })
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.clash).toBeNull()
    // The local edits are kept...
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(8)
    // ...and pushed to disk.
    const applies = lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
    expect(applies.length).toBeGreaterThan(0)
  })

  it('flushes edits made while offline to disk on reconnect (not just on the next edit)', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.saveState).toBe('saved')

    // Socket drops; the user edits while offline. The edit has nowhere to send,
    // but it IS mirrored to the browser backup with the synced base.
    await act(async () => lastSocket().onclose?.())
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 400, 80)
    })
    const localCx = useDiagramStore.getState().layout.nodes.a!.cx
    expect(localCx).not.toBe(2) // the offline edit moved it
    const offlineApplies = lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
    expect(offlineApplies).toHaveLength(0) // nothing left the (dead) socket

    // Reconnect: a fresh socket opens after the backoff and re-hydrates disk
    // (still cx 2). The offline edit must be pushed now — without another edit.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
    await act(async () => lastSocket().open())
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(localCx) // local kept
    const applies = lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
    expect(applies.length).toBeGreaterThan(0)
    const layoutFrame = applies.at(-1)!.files.find((f: { kind: string }) => f.kind === 'layout')
    expect(JSON.parse(layoutFrame.content).nodes.a.cx).toBe(localCx)
    expect(result.current.saveState).toBe('saving') // awaiting the server's ack
  })

  it('reports saveState offline when the socket drops', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.saveState).toBe('saved')
    await act(async () => lastSocket().onclose?.())
    expect(result.current.saveState).toBe('offline')
  })

  it('does NOT write to disk before the first hydrate (no clobber on slow reconnect)', async () => {
    renderHook(() => useBridge())
    await connect()
    // Connected, but the authoritative disk state has NOT arrived yet. The store
    // still holds its empty bootstrap baseline; a local edit here must be
    // withheld, or it would overwrite the user's file with an empty layout.
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 200, 80)
    })
    const applyTypes = () =>
      lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
    expect(applyTypes()).toHaveLength(0)

    // Once the disk baseline lands, edits are safe to persist again.
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 400, 80)
    })
    expect(applyTypes().length).toBeGreaterThan(0)
  })

  it('defers a reconnect re-hydrate while the user is interacting', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    // Drop + reconnect while the pointer is down (a drag may be in flight).
    await act(async () => interaction.setPointerDown(true))
    const beforeDrop = sockets.length
    await act(async () => {
      lastSocket().onclose?.()
    })
    // Wait out the default reconnect backoff (~400ms) for the new socket.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
    expect(sockets.length).toBe(beforeDrop + 1)
    await act(async () => lastSocket().open())
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(7))))
    // Reconnect hydrate is deferred — the canvas is NOT yanked mid-drag.
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2)
    expect(result.current.diskChanged).toBe(true)

    // Pointer-up reconciles to the reconnected disk state.
    await act(async () => interaction.setPointerDown(false))
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(7)
  })

  it('keeps last-good content and flags an error when disk is invalid', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    await act(async () => {
      lastSocket().emit({ type: 'fileChanged', doc: 'sys', kind: 'layout', content: '{ bad', valid: false, error: '1:1 oops' })
    })
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2) // unchanged
    expect(result.current.remoteError).toContain('oops')
  })
})
