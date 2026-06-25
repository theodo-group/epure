import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { route } from './elk'
import { DEFAULT_NODE_H, DEFAULT_NODE_W, normalizeForRoute } from './normalize'
import type { LayoutSidecar } from './types'

function diagramOf(source: string) {
  const result = parse(source)
  if (!result.ok) throw new Error(`parse failed: ${result.errors[0]?.message}`)
  return result.diagram
}

const emptyLayout = (gridSize = 40): LayoutSidecar => ({
  gridSize,
  nodes: {},
  edges: {},
})

describe('normalizeForRoute', () => {
  it('synthesizes a default-sized entry for every node missing from layout', () => {
    const diagram = diagramOf('a\nb\nc\n')
    const out = normalizeForRoute(diagram, emptyLayout())

    expect(Object.keys(out.nodes).sort()).toEqual(['a', 'b', 'c'])
    for (const id of ['a', 'b', 'c']) {
      expect(out.nodes[id]).toMatchObject({ w: DEFAULT_NODE_W, h: DEFAULT_NODE_H })
    }
  })

  it('is deterministic — same diagram + layout always yields the same placement', () => {
    const diagram = diagramOf('a\nb\nc\nd\n')
    const first = normalizeForRoute(diagram, emptyLayout())
    const second = normalizeForRoute(diagram, emptyLayout())
    expect(second.nodes).toEqual(first.nodes)
  })

  it('lays nodes left-to-right at a fixed stride', () => {
    const diagram = diagramOf('a\nb\n')
    const out = normalizeForRoute(diagram, emptyLayout())
    // Same row (cy equal), b strictly to the right of a.
    expect(out.nodes.b!.cy).toBe(out.nodes.a!.cy)
    expect(out.nodes.b!.cx).toBeGreaterThan(out.nodes.a!.cx)
  })

  it('returns the layout untouched when every node is already placed', () => {
    const diagram = diagramOf('a\nb\n')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        a: { cx: 2, cy: 2, w: 4, h: 2 },
        b: { cx: 8, cy: 2, w: 4, h: 2 },
      },
      edges: {},
    }
    // Identity — no synthesis needed, so the caller never re-serializes.
    expect(normalizeForRoute(diagram, layout)).toBe(layout)
  })

  it('preserves existing entries and places new nodes below the placed bounding box', () => {
    const diagram = diagramOf('a\nb\n')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: { a: { cx: 5, cy: 10, w: 4, h: 2 } },
      edges: {},
    }
    const out = normalizeForRoute(diagram, layout)
    // Existing node untouched.
    expect(out.nodes.a).toEqual(layout.nodes.a)
    // New node sits below a's bottom edge (cy 10 + h/2 = 11).
    expect(out.nodes.b!.cy).toBeGreaterThan(11)
  })
})

describe('route() with a missing/empty layout (Phase 0 blocker)', () => {
  it('renders every .d2 node when the layout is empty, instead of blanking', async () => {
    const diagram = diagramOf('a\nb\nc\na -> b\nb -> c\n')
    const routed = await route(diagram, normalizeForRoute(diagram, emptyLayout()))
    expect(routed.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(routed.edges).toHaveLength(2)
  })

  it('does not throw even when route is called with a raw empty layout', async () => {
    const diagram = diagramOf('lonely\n')
    // Exercises the defensive fallback in elk.ts directly (no normalization).
    await expect(route(diagram, emptyLayout())).resolves.toBeTruthy()
  })

  it('produces stable geometry across reruns', async () => {
    const diagram = diagramOf('a\nb\nc\na -> b\n')
    const layout = normalizeForRoute(diagram, emptyLayout())
    const first = await route(diagram, layout)
    const second = await route(diagram, layout)
    expect(second.nodes).toEqual(first.nodes)
  })
})
