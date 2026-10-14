import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { route } from './elk'
import { normalizeForRoute } from './normalize'
import { DEFAULT_NODE_H, DEFAULT_NODE_W } from './defaults'
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

  it('returns the layout unchanged (and does not mutate it) when every node is placed', () => {
    const diagram = diagramOf('a\nb\n')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        a: { cx: 2, cy: 2, w: 4, h: 2 },
        b: { cx: 8, cy: 2, w: 4, h: 2 },
      },
      edges: { 'a->b': { color: 'blue' } },
    }
    const before = structuredClone(layout)
    expect(normalizeForRoute(diagram, layout)).toEqual(before)
    expect(layout).toEqual(before)
  })

  it('never stacks auto-placed nodes on each other, across a row wrap', () => {
    // Eight nodes: more than one row, so both strides are exercised.
    const diagram = diagramOf('a\nb\nc\nd\ne\nf\ng\nh\n')
    const placed = { gridSize: 40, nodes: { x: { cx: 3, cy: 3, w: 8, h: 4 } }, edges: {} }
    for (const layout of [emptyLayout(), placed]) {
      const out = normalizeForRoute(diagram, layout)
      const boxes = Object.entries(out.nodes)
      expect(boxes).toHaveLength(Object.keys(layout.nodes).length + 8)
      for (const [i, [idA, a]] of boxes.entries()) {
        for (const [idB, b] of boxes.slice(i + 1)) {
          const apart =
            Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 || Math.abs(a.cy - b.cy) >= (a.h + b.h) / 2
          expect(apart, `${idA} overlaps ${idB}`).toBe(true)
        }
      }
    }
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
    // Exercises the defensive fallback in geometry.ts (nodeRects) directly (no
    // normalization): the node still renders, default-sized at the origin.
    const routed = await route(diagram, emptyLayout())
    expect(routed.nodes).toMatchObject([{ id: 'lonely', x: -80, y: -40, w: 160, h: 80 }])
  })

  it('produces stable geometry across reruns', async () => {
    const diagram = diagramOf('a\nb\nc\na -> b\n')
    const layout = normalizeForRoute(diagram, emptyLayout())
    const first = await route(diagram, layout)
    const second = await route(diagram, layout)
    expect(second.nodes).toEqual(first.nodes)
  })
})
