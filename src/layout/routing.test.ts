// Edges must route AROUND a node sitting between their endpoints, not through
// it. (Setup loads libavoid's real wasm, so this exercises production routing.)

import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { route } from './elk'
import { normalizeForRoute } from './normalize'
import type { LayoutSidecar, RoutedDiagram } from './types'

const segHitsRect = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): boolean => {
  const inset = 2
  for (let t = 0; t <= 1; t += 0.02) {
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (x > r.x + inset && x < r.x + r.w - inset && y > r.y + inset && y < r.y + r.h - inset) {
      return true
    }
  }
  return false
}

const rectOf = (routed: RoutedDiagram, id: string) => {
  const n = routed.nodes.find((node) => node.id === id)!
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

describe('edge obstacle avoidance', () => {
  it('routes an edge around a node placed directly between its endpoints', async () => {
    const parsed = parse('a\nb\nblocker\na -> b\n')
    if (!parsed.ok) throw new Error('parse failed')
    // a — blocker — b, all on the same row, so a→b's straight path hits blocker.
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        a: { cx: 3, cy: 6, w: 4, h: 2 },
        blocker: { cx: 12, cy: 6, w: 4, h: 2 },
        b: { cx: 21, cy: 6, w: 4, h: 2 },
      },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const edge = routed.edges.find((e) => e.id.startsWith('a->b'))!
    const blocker = rectOf(routed, 'blocker')

    const crosses = edge.points.some((_, i) =>
      i > 0 ? segHitsRect(edge.points[i - 1]!, edge.points[i]!, blocker) : false,
    )
    expect(crosses).toBe(false)
    // It still connects a to b.
    expect(edge.points.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps a clear straight edge straight (no needless detour)', async () => {
    const parsed = parse('a\nb\na -> b\n')
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: { a: { cx: 3, cy: 6, w: 4, h: 2 }, b: { cx: 12, cy: 6, w: 4, h: 2 } },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const edge = routed.edges.find((e) => e.id.startsWith('a->b'))!
    // Nothing in the way → a tidy 2-point straight segment.
    expect(edge.points).toHaveLength(2)
  })
})
