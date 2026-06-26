// Integration test for the React glue: hydrate → store, fileChanged → store via
// the paused chokepoint, and the interaction guard deferring inbound applies.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { useDiagramStore } from '@/store/diagramStore'

import { __setTestSocketFactory, useBridge } from './useBridge'
import { interaction } from './interaction'
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

beforeEach(() => {
  sockets = []
  interaction._reset()
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

  it('tracks the agent dot, matches a resolution, and serializes a feedback submit', async () => {
    const { result } = renderHook(() => useBridge())
    await connect()
    await act(async () => lastSocket().emit(hydrate(D2, layoutText(2))))

    // The agent attaches/detaches → drives the dot.
    await act(async () => lastSocket().emit({ type: 'feedbackStatus', agentPolling: true }))
    expect(result.current.agentPolling).toBe(true)

    // A submit serializes the right WS frame (ephemeral, not an `apply`).
    await act(async () => {
      result.current.submitFeedback('fb9', 'make it teal', { kind: 'element', ref: 'a' })
    })
    const feedbackFrames = lastSocket().sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'feedback')
    expect(feedbackFrames).toEqual([
      { type: 'feedback', doc: 'sys', id: 'fb9', text: 'make it teal', target: { kind: 'element', ref: 'a' } },
    ])

    // Pickup flips the toolbar to "thinking".
    await act(async () => lastSocket().emit({ type: 'feedbackPickedUp', id: 'fb9' }))
    expect(result.current.lastPickedUp).toBe('fb9')

    // The agent's reply surfaces as the last resolution.
    await act(async () => lastSocket().emit({ type: 'feedbackResolved', id: 'fb9', status: 'done', message: 'teal' }))
    expect(result.current.lastResolved).toMatchObject({ id: 'fb9', status: 'done', message: 'teal' })
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
