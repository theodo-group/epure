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

  it('routes a non-member edge AROUND an area sitting between its endpoints', async () => {
    // o1 and o2 are on the same row with a two-node cluster (box) stacked
    // between them — the straight o1→o2 line would pass through the area. Neither
    // endpoint is a member, so the area is an obstacle and the edge must detour.
    const parsed = parse(
      'o1\no2\nm1\nm2\no1 -> o2\nbox: "Box" {\n  m1\n  m2\n}\n',
    )
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        o1: { cx: 3, cy: 8, w: 4, h: 2 },
        m1: { cx: 16, cy: 6, w: 4, h: 2 },
        m2: { cx: 16, cy: 10, w: 4, h: 2 },
        o2: { cx: 30, cy: 8, w: 4, h: 2 },
      },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const edge = routed.edges.find((e) => e.id.startsWith('o1->o2'))!
    const area = routed.areas.find((a) => a.id === 'box')!
    const areaRect = { x: area.x, y: area.y, w: area.w, h: area.h }
    const crosses = edge.points.some((_, i) =>
      i > 0 ? segHitsRect(edge.points[i - 1]!, edge.points[i]!, areaRect) : false,
    )
    expect(crosses).toBe(false)
  })

  it('lets a member edge enter its own area (membership = permeable)', async () => {
    // hub (outside) → m1 (inside box). The area must NOT block this edge or m1
    // would be unreachable. The edge simply has to connect.
    const parsed = parse('hub\nm1\nm2\nhub -> m1\nbox: "Box" {\n  m1\n  m2\n}\n')
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        hub: { cx: 3, cy: 6, w: 4, h: 2 },
        m1: { cx: 16, cy: 6, w: 4, h: 2 },
        m2: { cx: 16, cy: 10, w: 4, h: 2 },
      },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const edge = routed.edges.find((e) => e.id.startsWith('hub->m1'))!
    expect(edge.points.length).toBeGreaterThanOrEqual(2)
    // Ends on m1's border.
    const m1 = rectOf(routed, 'm1')
    const end = edge.points[edge.points.length - 1]!
    const onBorder =
      Math.abs(end.x - m1.x) < 2 ||
      Math.abs(end.x - (m1.x + m1.w)) < 2 ||
      Math.abs(end.y - m1.y) < 2 ||
      Math.abs(end.y - (m1.y + m1.h)) < 2
    expect(onBorder).toBe(true)
  })

  it('is deterministic — identical geometry across repeated routes', async () => {
    // Same input must yield byte-identical points (the git-reviewable export and
    // the editor both depend on this; libavoid is deterministic and the snap /
    // distribution passes must not introduce any nondeterminism).
    const parsed = parse(
      'a\nb\nc\nblocker\na -> b\na -> c\nb -> c\nc -> a\n',
    )
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        a: { cx: 3, cy: 4, w: 4, h: 2 },
        b: { cx: 16, cy: 4, w: 4, h: 2 },
        c: { cx: 16, cy: 12, w: 4, h: 2 },
        blocker: { cx: 9, cy: 8, w: 4, h: 2 },
      },
      edges: {},
    }
    const run = async () =>
      (await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))).edges
        .map((e) => `${e.id}:${e.points.map((p) => `${p.x},${p.y}`).join(' ')}`)
        .join('|')
    expect(await run()).toBe(await run())
  })

  it('a fan-out from one node does not cross itself', async () => {
    // One hub with edges to targets spread around it. The port-ordering must lay
    // the junctions out so the fan nests rather than tangles.
    const parsed = parse('hub\nn\ns\ne\nw\nhub -> n\nhub -> s\nhub -> e\nhub -> w\n')
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        hub: { cx: 14, cy: 10, w: 4, h: 2 },
        n: { cx: 14, cy: 3, w: 4, h: 2 },
        s: { cx: 14, cy: 17, w: 4, h: 2 },
        e: { cx: 24, cy: 10, w: 4, h: 2 },
        w: { cx: 4, cy: 10, w: 4, h: 2 },
      },
      edges: {},
    }
    const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
    const isH = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5
    const cross = (h: any[], v: any[]) => {
      const e = 1
      return (
        v[0].x > Math.min(h[0].x, h[1].x) + e && v[0].x < Math.max(h[0].x, h[1].x) - e &&
        h[0].y > Math.min(v[0].y, v[1].y) + e && h[0].y < Math.max(v[0].y, v[1].y) - e
      )
    }
    const segsOf = (e: (typeof routed.edges)[number]) =>
      e.points.slice(1).map((p, i) => [e.points[i]!, p])
    let crossings = 0
    for (let i = 0; i < routed.edges.length; i += 1) {
      for (let j = i + 1; j < routed.edges.length; j += 1) {
        for (const s1 of segsOf(routed.edges[i]!)) {
          for (const s2 of segsOf(routed.edges[j]!)) {
            const h = isH(s1[0]!, s1[1]!)
            const h2 = isH(s2[0]!, s2[1]!)
            if (h && !h2 && cross(s1, s2)) crossings += 1
            else if (!h && h2 && cross(s2, s1)) crossings += 1
          }
        }
      }
    }
    expect(crossings).toBe(0)
  })

  it('quick mode is valid and reuses the cached faces of the full route', async () => {
    // The interactive (mid-drag) quick path skips face-learning by reusing the
    // cache the full route warms, and skips the swap pass — but must still produce
    // valid orthogonal routes that agree with the full route on which face each
    // edge uses (so the geometry barely shifts when the drag settles).
    const parsed = parse('hub\na\nb\nc\nhub -> a\nhub -> b\nhub -> c\nb -> c\n')
    if (!parsed.ok) throw new Error('parse failed')
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        hub: { cx: 6, cy: 10, w: 4, h: 2 },
        a: { cx: 18, cy: 4, w: 4, h: 2 },
        b: { cx: 18, cy: 10, w: 4, h: 2 },
        c: { cx: 18, cy: 16, w: 4, h: 2 },
      },
      edges: {},
    }
    const norm = normalizeForRoute(parsed.diagram, layout)
    const full = await route(parsed.diagram, norm) // warms the face cache
    const quick = await route(parsed.diagram, norm, { quick: true })
    // Quick routes are orthogonal and connect.
    for (const e of quick.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < e.points.length; i += 1) {
        const a = e.points[i - 1]!, b = e.points[i]!
        expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5).toBe(true)
      }
    }
    // Faces agree with the full route (cache reuse).
    const faceOf = (r: typeof full, id: string) => {
      const e = r.edges.find((x) => x.id === id)!
      return `${e.source.side}${e.target.side}`
    }
    for (const e of full.edges) {
      expect(faceOf(quick, e.id)).toBe(faceOf(full, e.id))
    }
  })
})
