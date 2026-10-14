// @vitest-environment jsdom
//
// Integration test for the React glue: hydrate → store, fileChanged → store via
// the paused chokepoint, and the interaction guard deferring inbound applies.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { useDiagramStore } from '@/store/diagramStore'

import { useBridge } from './useBridge'
import { interaction } from './interaction'
import { docKeyOf, readBackup, writeBackup } from './offlineBackup'
import type { LayoutSidecar } from '@/layout/types'
import type { SocketFactory, SocketLike } from './BridgeClient'
import type { ServerMsg } from './protocol'

class FakeSocket implements SocketLike {
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  send(d: string) {
    this.sent.push(d)
  }
  close() {}
  open() {
    this.onopen?.()
  }
  emit(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

let sockets: FakeSocket[] = []
const lastSocket = () => sockets[sockets.length - 1]!
const socketFactory: SocketFactory = () => {
  const s = new FakeSocket()
  sockets.push(s)
  return s
}
const renderBridge = () => renderHook(() => useBridge({ socketFactory }))

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
  // Fake clock: the debounce, offline fallback, reconnect backoff and the
  // interaction guard's quiet window all advance only when a test says so.
  vi.useFakeTimers()
  sockets = []
  interaction._reset()
  installLocalStorage()
  useDiagramStore.getState().loadDocument('', { gridSize: 40, nodes: {}, edges: {} })
  window.__EPURE_BRIDGE__ = {
    token: 'tok',
    wsUrl: '/__epure/ws',
    protocol: 1,
    doc: 'sys',
    file: '/x',
    version: '1',
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.__EPURE_BRIDGE__
})

// Let the client connect (detection is synchronous; the socket opens next tick).
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
    const { result } = renderBridge()
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
    renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    await act(async () => {
      lastSocket().emit({
        type: 'fileChanged',
        doc: 'sys',
        kind: 'layout',
        content: layoutText(8),
        valid: true,
      })
    })
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(8)
  })

  it('defers an inbound apply while the user is interacting, then reconciles', async () => {
    const { result } = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    // Pointer is down (a drag may be in flight) → guard is "busy".
    await act(async () => interaction.setPointerDown(true))
    await act(async () => {
      lastSocket().emit({
        type: 'fileChanged',
        doc: 'sys',
        kind: 'layout',
        content: layoutText(9),
        valid: true,
      })
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
    renderBridge()
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
    const applies = lastSocket()
      .sent.map((s) => JSON.parse(s))
      .filter((m) => m.type === 'apply')
    expect(applies).toHaveLength(0)
  })

  it('reports saveState saving → saved across an edit and its ack', async () => {
    const { result } = renderBridge()
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

  it('coalesces a burst of edits into a leading + single trailing write', async () => {
    const { result } = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    const applyMsgs = () =>
      lastSocket()
        .sent.map((s) => JSON.parse(s))
        .filter((m) => m.type === 'apply')
    expect(applyMsgs()).toHaveLength(0)

    // Three edits fired synchronously — a stand-in for a keystroke/drag burst.
    await act(async () => {
      const st = useDiagramStore.getState()
      st.moveNode('a', 400, 80) // cx 10
      st.moveNode('a', 480, 80) // cx 12
      st.moveNode('a', 560, 80) // cx 14
    })
    // Only the leading edge has shipped; the other two are buffered behind the
    // debounce, but the cue already reflects unsaved work.
    expect(applyMsgs()).toHaveLength(1)
    expect(result.current.saveState).toBe('saving')

    // Once edits go quiet, exactly one trailing write carries the FINAL state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    const applies = applyMsgs()
    expect(applies).toHaveLength(2)
    const lastLayout = applies.at(-1)!.files.find((f: { kind: string }) => f.kind === 'layout')
    expect(JSON.parse(lastLayout.content).nodes.a.cx).toBe(14)
  })

  const layoutObj = (cx: number): LayoutSidecar => ({
    gridSize: 40,
    nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
    edges: {},
  })

  it('falls back to the browser backup when no hydrate arrives (server down)', async () => {
    writeBackup('sys', { source: D2, layout: layoutObj(7), base: null, savedAt: 1 })
    const { result } = renderBridge()
    await connect() // socket opens, but the server never sends a hydrate
    // Within the grace period a healthy connection may still hydrate: keep waiting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.usingLocalCopy).toBe(false)
    // Past it, show the browser backup rather than a blank canvas.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(result.current.usingLocalCopy).toBe(true)
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(7)
  })

  it('prompts on a genuine clash (local and disk both diverged from base)', async () => {
    // base = layout(5); local = layout(8); disk = layout(2) → all differ.
    writeBackup('sys', {
      source: D2,
      layout: layoutObj(8),
      base: docKeyOf(D2, layoutObj(5)),
      savedAt: 99,
    })
    const { result } = renderBridge()
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
    writeBackup('sys', {
      source: D2,
      layout: layoutObj(8),
      base: docKeyOf(D2, layoutObj(2)),
      savedAt: 7,
    })
    const { result } = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.clash).toBeNull()
    // The local edits are kept...
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(8)
    // ...and pushed to disk.
    const applies = lastSocket()
      .sent.map((s) => JSON.parse(s))
      .filter((m) => m.type === 'apply')
    expect(applies.length).toBeGreaterThan(0)
  })

  it('flushes edits made while offline to disk on reconnect (not just on the next edit)', async () => {
    const { result } = renderBridge()
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
    const offlineApplies = lastSocket()
      .sent.map((s) => JSON.parse(s))
      .filter((m) => m.type === 'apply')
    expect(offlineApplies).toHaveLength(0) // nothing left the (dead) socket

    // Reconnect: a fresh socket opens after the backoff and re-hydrates disk
    // (still cx 2). The offline edit must be pushed now — without another edit.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await act(async () => lastSocket().open())
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(localCx) // local kept
    const applies = lastSocket()
      .sent.map((s) => JSON.parse(s))
      .filter((m) => m.type === 'apply')
    expect(applies.length).toBeGreaterThan(0)
    const layoutFrame = applies.at(-1)!.files.find((f: { kind: string }) => f.kind === 'layout')
    expect(JSON.parse(layoutFrame.content).nodes.a.cx).toBe(localCx)
    expect(result.current.saveState).toBe('saving') // awaiting the server's ack
  })

  it('reports saveState offline when the socket drops', async () => {
    const { result } = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    expect(result.current.saveState).toBe('saved')
    await act(async () => lastSocket().onclose?.())
    expect(result.current.saveState).toBe('offline')
  })

  it('does NOT write to disk before the first hydrate (no clobber on slow reconnect)', async () => {
    renderBridge()
    await connect()
    // Connected, but the authoritative disk state has NOT arrived yet. The store
    // still holds its empty bootstrap baseline; a local edit here must be
    // withheld, or it would overwrite the user's file with an empty layout.
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 200, 80)
    })
    const applyTypes = () =>
      lastSocket()
        .sent.map((s) => JSON.parse(s))
        .filter((m) => m.type === 'apply')
    expect(applyTypes()).toHaveLength(0)

    // Once the disk baseline lands, edits are safe to persist again.
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    await act(async () => {
      useDiagramStore.getState().moveNode('a', 400, 80)
    })
    expect(applyTypes().length).toBeGreaterThan(0)
  })

  it('defers a reconnect re-hydrate while the user is interacting', async () => {
    const { result } = renderBridge()
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
      await vi.advanceTimersByTimeAsync(600)
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
    const { result } = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    await act(async () => {
      lastSocket().emit({
        type: 'fileChanged',
        doc: 'sys',
        kind: 'layout',
        content: '{ bad',
        valid: false,
        error: '1:1 oops',
      })
    })
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2) // unchanged
    expect(result.current.remoteError).toContain('oops')
  })
})

// ── Sync invariant: editor == disk, or an open clash prompt ─────────────────

const layoutAt = (cx: number): LayoutSidecar => ({
  gridSize: 40,
  nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
  edges: {},
})

interface ApplyMsg {
  type: 'apply'
  files: { kind: 'd2' | 'layout'; content: string }[]
}
const appliesOn = (socket: FakeSocket): ApplyMsg[] =>
  socket.sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'apply')
/** Every d2 content sent to disk, in order. */
const d2Sent = (socket: FakeSocket): string[] =>
  appliesOn(socket).flatMap((m) => m.files.filter((f) => f.kind === 'd2').map((f) => f.content))
const wait = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useBridge: first-load clash', () => {
  // base = D2 at cx 5; local = D2 plus a node, at cx 8; disk = D2 at cx 2.
  const LOCAL_D2 = `${D2}local\n`
  const backup = {
    source: LOCAL_D2,
    layout: layoutAt(8),
    base: docKeyOf(D2, layoutAt(5)),
    savedAt: 99,
  }
  const open = async () => {
    writeBackup('sys', backup)
    const view = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    return view
  }

  it('writes nothing to disk and keeps the backup until the user chooses', async () => {
    const { result } = await open()
    expect(result.current.clash).not.toBeNull()
    expect(appliesOn(lastSocket())).toHaveLength(0)
    await wait(5000)
    expect(appliesOn(lastSocket())).toHaveLength(0)
    // Closing the tab now must leave the same choice for the next visit.
    expect(readBackup('sys')).toEqual(backup)
  })

  it('"Use the disk version" never writes the local copy', async () => {
    const { result } = await open()
    await act(async () => result.current.resolveClash('disk'))
    await wait(2000)
    expect(result.current.clash).toBeNull()
    expect(appliesOn(lastSocket())).toHaveLength(0)
    expect(useDiagramStore.getState().source).toBe(D2)
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(2)
    // The backup is re-based onto disk: the next load takes disk silently.
    expect(readBackup('sys')?.base).toBe(docKeyOf(D2, layoutAt(2)))
  })

  it('"Keep my version" sends the local copy', async () => {
    const { result } = await open()
    await act(async () => result.current.resolveClash('local'))
    expect(result.current.clash).toBeNull()
    const applies = appliesOn(lastSocket())
    expect(applies).toHaveLength(1)
    const sent = Object.fromEntries(applies[0]!.files.map((f) => [f.kind, f.content]))
    expect(sent.d2).toBe(LOCAL_D2)
    expect(JSON.parse(sent.layout!).nodes.a.cx).toBe(8)
    expect(useDiagramStore.getState().source).toBe(LOCAL_D2)
    expect(readBackup('sys')?.base).toBe(docKeyOf(LOCAL_D2, layoutAt(8)))
  })

  it("moves the prompt's disk side on when disk changes before the choice", async () => {
    const { result } = await open()
    await act(async () =>
      lastSocket().emit({
        type: 'fileChanged',
        doc: 'sys',
        kind: 'layout',
        content: layoutText(11),
        valid: true,
      }),
    )
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(8) // still the local copy
    expect(appliesOn(lastSocket())).toHaveLength(0)
    await act(async () => result.current.resolveClash('disk'))
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(11)
    expect(appliesOn(lastSocket())).toHaveLength(0)
  })
})

describe('useBridge: a disk change while the user is editing', () => {
  const DISK_D2 = `${D2}disk\n`
  const fileChanged = (kind: 'd2' | 'layout', content: string): ServerMsg => ({
    type: 'fileChanged',
    doc: 'sys',
    kind,
    content,
    valid: true,
  })
  // What the editor does on a keystroke: App notes activity, then sets source.
  const type = async (source: string) => {
    await act(async () => {
      interaction.noteActivity()
      useDiagramStore.getState().setSource(source)
    })
  }
  const drag = async (x: number) => {
    await act(async () => {
      interaction.noteActivity()
      useDiagramStore.getState().moveNode('a', x, 80)
    })
  }
  const start = async () => {
    const view = renderBridge()
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))
    return view
  }

  // The user types; mid-burst, the same file changes on disk; they keep typing.
  const typeThroughDiskChange = async () => {
    const view = await start()
    await type(`${D2}x\n`) // leading edge: sent at once
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`])
    await act(async () => lastSocket().emit({ type: 'applied', doc: 'sys', kinds: ['d2'] }))
    await act(async () => lastSocket().emit(fileChanged('d2', DISK_D2)))
    expect(view.result.current.diskChanged).toBe(true)
    await wait(100)
    await type(`${D2}xy\n`)
    await wait(100)
    await type(`${D2}xyz\n`)
    // Past the debounce: the typed text must NOT overwrite the disk change.
    await wait(300)
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`])
    // Idle: both sides changed the d2 → the clash prompt; nothing overwritten.
    await wait(1500)
    expect(view.result.current.clash).not.toBeNull()
    expect(view.result.current.diskChanged).toBe(false)
    expect(useDiagramStore.getState().source).toBe(`${D2}xyz\n`)
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`])
    expect(view.result.current.saveState).not.toBe('saved')
    return view
  }

  it('raises a clash once idle; "Keep my version" sends the typed text', async () => {
    const { result } = await typeThroughDiskChange()
    await act(async () => result.current.resolveClash('local'))
    expect(result.current.clash).toBeNull()
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`, `${D2}xyz\n`])
    expect(useDiagramStore.getState().source).toBe(`${D2}xyz\n`)
  })

  it('raises a clash once idle; "Use the disk version" takes disk and writes nothing', async () => {
    const { result } = await typeThroughDiskChange()
    await act(async () => result.current.resolveClash('disk'))
    await wait(2000)
    expect(result.current.clash).toBeNull()
    expect(useDiagramStore.getState().source).toBe(DISK_D2)
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`])
    expect(result.current.saveState).toBe('saved')
  })

  it('applies a disk change to the other file once idle, without a clash', async () => {
    const { result } = await start()
    await drag(400) // a layout edit, sent at once
    await act(async () => lastSocket().emit(fileChanged('d2', DISK_D2)))
    await wait(100)
    await drag(480)
    await wait(300)
    // The untouched d2 is never sent: disk's new d2 stands.
    expect(d2Sent(lastSocket())).toEqual([])
    await wait(1500)
    expect(result.current.clash).toBeNull()
    expect(useDiagramStore.getState().source).toBe(DISK_D2)
    const layouts = appliesOn(lastSocket()).flatMap((m) =>
      m.files.filter((f) => f.kind === 'layout').map((f) => JSON.parse(f.content).nodes.a.cx),
    )
    expect(layouts.at(-1)).toBe(useDiagramStore.getState().layout.nodes.a!.cx)
    expect(d2Sent(lastSocket())).toEqual([])
  })

  it('settles a reconnect hydrate deferred mid-drag the same way, per kind', async () => {
    const { result } = await start()
    await act(async () => lastSocket().onclose?.())
    await wait(600)
    await act(async () => lastSocket().open())
    // Mid-drag, the reconnect brings a new d2 AND a moved node: both deferred.
    await act(async () => interaction.setPointerDown(true))
    await act(async () => lastSocket().emit(hydrate(DISK_D2, layoutText(7))))
    expect(result.current.diskChanged).toBe(true)
    await drag(400) // the drag goes on: the layout is held, not sent
    await wait(300)
    expect(appliesOn(lastSocket())).toHaveLength(0)
    // Pointer-up: the untouched d2 is applied; the layout, moved on both sides,
    // is the clash. Nothing was written.
    await act(async () => interaction.setPointerDown(false))
    await wait(1500)
    expect(result.current.clash).not.toBeNull()
    expect(useDiagramStore.getState().source).toBe(DISK_D2)
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(10)
    expect(appliesOn(lastSocket())).toHaveLength(0)
    await act(async () => result.current.resolveClash('disk'))
    expect(useDiagramStore.getState().layout.nodes.a!.cx).toBe(7)
    expect(appliesOn(lastSocket())).toHaveLength(0)
  })

  it('applies a deferred change to a file whose edits were all saved before it', async () => {
    const { result } = await start()
    await type(`${D2}x\n`) // sent at once; disk then moves on from it
    await act(async () => lastSocket().emit(fileChanged('d2', `${D2}x\ndisk\n`)))
    await wait(2000)
    expect(result.current.clash).toBeNull()
    expect(useDiagramStore.getState().source).toBe(`${D2}x\ndisk\n`)
    expect(d2Sent(lastSocket())).toEqual([`${D2}x\n`])
  })
})
