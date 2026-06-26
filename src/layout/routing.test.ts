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

  it('honors a pinned source/target side over the geometric default', async () => {
    const parsed = parse('a\nb\na -> b\n')
    if (!parsed.ok) throw new Error('parse failed')
    // b sits to the lower-RIGHT of a: the x gap dominates, so geometry would
    // pick source E / target W. Pin the vertical faces (S/N) instead — they
    // still face each other — and require the routed stubs to obey.
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: { a: { cx: 3, cy: 6, w: 4, h: 2 }, b: { cx: 15, cy: 9, w: 4, h: 2 } },
      edges: { 'a->b': { sourceSide: 'S', targetSide: 'N' } },
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const edge = routed.edges.find((e) => e.id.startsWith('a->b'))!
    // Recorded sides match the pin (not the geometric E/W)...
    expect(edge.source.side).toBe('S')
    expect(edge.target.side).toBe('N')
    // ...and the geometry obeys: the first segment leaves a's South face going
    // down, the last arrives at b's North face from above.
    const [p0, p1] = [edge.points[0]!, edge.points[1]!]
    expect(p1.y).toBeGreaterThan(p0.y) // leaves downward (S)
    const [pl, pPrev] = [
      edge.points[edge.points.length - 1]!,
      edge.points[edge.points.length - 2]!,
    ]
    expect(pPrev.y).toBeLessThan(pl.y) // arrives from above (N)
  })

  it('separates the overlapping bend legs of a counter-directional pair', async () => {
    // a and b are offset on both axes, so a->b and b->a each route a vertical
    // Z-jog leg in the same channel. Without separation both legs land on the
    // same x and draw on top of each other; the resolver must split them.
    const parsed = parse('a\nb\na -> b\nb -> a\n')
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: { a: { cx: 3, cy: 4, w: 4, h: 2 }, b: { cx: 15, cy: 8, w: 4, h: 2 } },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const vleg = (id: string) => {
      const e = routed.edges.find((edge) => edge.id.startsWith(id))!
      for (let i = 1; i < e.points.length; i += 1) {
        const A = e.points[i - 1]!
        const B = e.points[i]!
        if (Math.abs(A.x - B.x) < 0.5 && Math.abs(A.y - B.y) > 0.5) {
          return { x: A.x, lo: Math.min(A.y, B.y), hi: Math.max(A.y, B.y) }
        }
      }
      return null
    }
    const v1 = vleg('a->b')!
    const v2 = vleg('b->a')!
    expect(v1).not.toBeNull()
    expect(v2).not.toBeNull()
    const yOverlap = Math.min(v1.hi, v2.hi) - Math.max(v1.lo, v2.lo)
    // The legs share a y span, so to not read as one line they must sit on
    // clearly distinct x channels — a comfortable gap, not a 1px tie-break.
    expect(yOverlap).toBeGreaterThan(4)
    expect(Math.abs(v1.x - v2.x)).toBeGreaterThanOrEqual(layout.gridSize - 1)

    // ...and the two links must NEST, not cross: separating them to the wrong
    // side would make webhook/reply-style pairs cross instead of stack.
    const legs = (id: string) => {
      const e = routed.edges.find((edge) => edge.id.startsWith(id))!
      const out: { vert: boolean; c: number; lo: number; hi: number }[] = []
      for (let i = 1; i < e.points.length; i += 1) {
        const a = e.points[i - 1]!
        const b = e.points[i]!
        const vert = Math.abs(a.x - b.x) < 0.5
        out.push({
          vert,
          c: vert ? a.x : a.y,
          lo: Math.min(vert ? a.y : a.x, vert ? b.y : b.x),
          hi: Math.max(vert ? a.y : a.x, vert ? b.y : b.x),
        })
      }
      return out
    }
    const crosses = (A: { vert: boolean; c: number; lo: number; hi: number }, B: typeof A) => {
      if (A.vert === B.vert) return false
      const v = A.vert ? A : B
      const h = A.vert ? B : A
      return v.c > h.lo && v.c < h.hi && h.c > v.lo && h.c < v.hi
    }
    const ab = legs('a->b')
    const ba = legs('b->a')
    const crossings = ab.filter((a) => ba.some((b) => crosses(a, b))).length
    expect(crossings).toBe(0)
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
