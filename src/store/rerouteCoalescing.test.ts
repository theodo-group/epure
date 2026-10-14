// The reroute scheduler: a drag fires a reroute per grid step, so a burst of
// requests must collapse to one route in flight plus one catch-up route against
// the LATEST layout, and a single full-quality route once the burst goes quiet.
// The real router runs; `route` is only wrapped to record each call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RouteOpts } from '@/layout/elk'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'

import { useDiagramStore } from './diagramStore'

const calls = vi.hoisted(() => [] as { quick: boolean; cx: number | undefined }[])

vi.mock('@/layout/elk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/layout/elk')>()
  return {
    ...real,
    route: (...args: Parameters<typeof real.route>) => {
      const [, layout, opts] = args as [unknown, LayoutSidecar, RouteOpts | undefined]
      calls.push({ quick: opts?.quick === true, cx: layout.nodes.a?.cx })
      return real.route(...args)
    },
  }
})

const st = () => useDiagramStore.getState()
const layoutAt = (cx: number): LayoutSidecar => ({
  gridSize: 40,
  nodes: { a: { cx, cy: 3, w: 4, h: 2 }, b: { cx: 20, cy: 3, w: 4, h: 2 } },
  edges: {},
})
const routedA = (r: RoutedDiagram | null) => r?.nodes.find((n) => n.id === 'a')?.x

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  st().loadDocument('a\nb\na -> b\n', layoutAt(3))
  st().reparse()
  calls.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe('reroute scheduling', () => {
  it('collapses a burst into one quick route plus one against the latest layout', async () => {
    const pending: Promise<void>[] = []
    for (const cx of [4, 5, 6, 7, 8]) {
      st().setLayout(layoutAt(cx))
      pending.push(st().reroute())
    }
    await Promise.all(pending)
    expect(calls).toEqual([
      { quick: true, cx: 4 }, // the first request starts routing at once
      { quick: true, cx: 8 }, // the other four collapse into one catch-up route
    ])
    expect(routedA(st().routed)).toBe((8 - 2) * 40)
  })

  it('follows with exactly one full route once the burst has been quiet for 200ms', async () => {
    st().setLayout(layoutAt(5))
    await st().reroute()
    st().setLayout(layoutAt(6))
    await st().reroute()
    expect(calls.every((c) => c.quick)).toBe(true)

    await vi.advanceTimersByTimeAsync(199)
    expect(calls.filter((c) => !c.quick)).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(calls.filter((c) => !c.quick)).toEqual([{ quick: false, cx: 6 }]))
    await vi.waitFor(() => expect(routedA(st().routed)).toBe((6 - 2) * 40))
  })
})
