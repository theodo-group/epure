// Unit tests for the router's pure stages, without libavoid: each pins the one
// decision its stage exists to make (pixel geometry throughout).

import type { RouteResult } from '@mr_mint/elkjs-libavoid'
import { describe, expect, it } from 'vitest'

import type { EdgeRoutingHints } from './anchors'
import { placePorts } from './anchors'
import { type EdgeMeta, FaceCache } from './faces'
import type { Pt } from './geometry'
import { labelAnchorFor } from './labels'
import { crossingPairs, pickPortSwaps, refinePortSwaps } from './refine'
import { adoptLibavoidRoute, snap, snapPolylineToGrid } from './snap'
import type { LayoutSidecar, Side } from './types'

const meta = (
  source: string,
  target: string,
  sourceSide: Side,
  targetSide: Side,
  pinned: { source?: boolean; target?: boolean } = {},
): EdgeMeta => ({
  source,
  target,
  sourceSide,
  targetSide,
  explicitSource: pinned.source ?? false,
  explicitTarget: pinned.target ?? false,
})

const result = (points: Pt[]): RouteResult => ({
  sourcePoint: points[0]!,
  targetPoint: points[points.length - 1]!,
  bendPoints: points.slice(1, -1),
  sourceSide: 'east',
  targetSide: 'west',
})

describe('grid snapping (snap.ts)', () => {
  it('rounds to the nearest grid line', () => {
    expect(snap(53, 20)).toBe(60)
    expect(snap(49, 20)).toBe(40)
  })

  it('snaps interior legs onto the grid and leaves the end legs on their anchors', () => {
    const poly = [
      { x: 0, y: 13 },
      { x: 53, y: 13 },
      { x: 53, y: 91 },
      { x: 100, y: 91 },
    ]
    expect(snapPolylineToGrid(poly, 20, {}, [], 'a', 'b')).toEqual([
      { x: 0, y: 13 },
      { x: 60, y: 13 },
      { x: 60, y: 91 },
      { x: 100, y: 91 },
    ])
  })

  it('does not snap a leg onto (or past) a neighbouring leg’s far end', () => {
    // x=93 would snap to 100 — the target anchor's x — collapsing the arrival leg.
    const poly = [
      { x: 0, y: 10 },
      { x: 93, y: 10 },
      { x: 93, y: 90 },
      { x: 100, y: 90 },
    ]
    expect(snapPolylineToGrid(poly, 20, {}, [], 'a', 'b')).toEqual(poly)
  })

  it('keeps the unsnapped route when snapping would push it into a foreign node', () => {
    const poly = [
      { x: 0, y: 13 },
      { x: 53, y: 13 },
      { x: 53, y: 91 },
      { x: 100, y: 91 },
    ]
    const blocker = { x: 56, y: 30, w: 30, h: 40 } // clear of x=53, hit by x=60
    expect(snapPolylineToGrid(poly, 20, { c: blocker }, [], 'a', 'b')).toEqual(poly)
  })
})

describe('adopting a libavoid route (snap.ts)', () => {
  const nodes = {}

  it('rejects a non-orthogonal (diagonal) route so the synthetic path takes over', () => {
    const diagonal = result([
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ])
    expect(adoptLibavoidRoute(diagonal, meta('a', 'b', 'E', 'W'), 20, nodes, [])).toBeUndefined()
  })

  it('accepts a sub-pixel wobble as orthogonal', () => {
    const wobble = result([
      { x: 0, y: 0 },
      { x: 100, y: 0.4 },
    ])
    expect(adoptLibavoidRoute(wobble, meta('a', 'b', 'E', 'W'), 20, nodes, [])).toBeDefined()
  })

  it('falls back when libavoid leaves a PINNED face from another face', () => {
    // Leaves upward (N) although the source is pinned to E.
    const viaNorth = result([
      { x: 0, y: 0 },
      { x: 0, y: -40 },
      { x: 100, y: -40 },
      { x: 100, y: 0 },
    ])
    const pinned = meta('a', 'b', 'E', 'S', { source: true })
    expect(adoptLibavoidRoute(viaNorth, pinned, 20, nodes, [])).toBeUndefined()
    // The same route is adopted when that end is not pinned (a learned face may differ).
    const free = meta('a', 'b', 'E', 'S')
    expect(adoptLibavoidRoute(viaNorth, free, 20, nodes, [])).toBeDefined()
  })

  it('falls back when libavoid arrives at a pinned TARGET face from another face', () => {
    const intoNorth = result([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
    ])
    const pinned = meta('a', 'b', 'E', 'W', { target: true })
    expect(adoptLibavoidRoute(intoNorth, pinned, 20, nodes, [])).toBeUndefined()
    const honoured = meta('a', 'b', 'E', 'N', { target: true })
    expect(adoptLibavoidRoute(intoNorth, honoured, 20, nodes, [])).toBeDefined()
  })
})

describe('port-swap refinement (refine.ts)', () => {
  // Two edges leaving hub's E face whose ports are in the wrong order: the
  // upper port goes to the lower node, so the legs cross.
  const ids = ['hub->low#0', 'hub->high#1']
  const edgeMeta = new Map([
    [ids[0]!, meta('hub', 'low', 'E', 'W')],
    [ids[1]!, meta('hub', 'high', 'E', 'W')],
  ])
  const crossed = new Map<string, Pt[]>([
    [
      ids[0]!,
      [
        { x: 0, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ],
    ],
    [
      ids[1]!,
      [
        { x: 0, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 0 },
        { x: 100, y: 0 },
      ],
    ],
  ])

  it('finds the crossing and swaps the ports of edges sharing a face', () => {
    expect(crossingPairs(crossed, ids)).toEqual([[ids[0], ids[1]]])
    expect(pickPortSwaps(crossed, ids, edgeMeta)).toEqual([
      { a: ids[0], b: ids[1], endA: 'source', endB: 'source' },
    ])
  })

  it('does not trigger for crossing edges that share no face', () => {
    const apart = new Map([
      [ids[0]!, meta('hub', 'low', 'E', 'W')],
      [ids[1]!, meta('other', 'high', 'E', 'W')],
    ])
    expect(pickPortSwaps(crossed, ids, apart)).toEqual([])
    // Same node, different faces: still nothing to reorder.
    const otherFace = new Map([
      [ids[0]!, meta('hub', 'low', 'E', 'W')],
      [ids[1]!, meta('hub', 'high', 'N', 'W')],
    ])
    expect(pickPortSwaps(crossed, ids, otherFace)).toEqual([])
  })

  const anchorsOf = (): Map<string, EdgeRoutingHints> =>
    new Map([
      [ids[0]!, { sourceAnchor: { x: 0, y: 10 }, targetAnchor: { x: 100, y: 100 } }],
      [ids[1]!, { sourceAnchor: { x: 0, y: 30 }, targetAnchor: { x: 100, y: 0 } }],
    ])
  const routesOf = (polys: Map<string, Pt[]>) =>
    new Map([...polys].map(([id, p]) => [id, result(p)] as const))

  it('keeps a swap that strictly lowers the crossing count', async () => {
    const anchors = anchorsOf()
    const uncrossed = new Map<string, Pt[]>([
      [ids[0]!, crossed.get(ids[0]!)!.map((p) => ({ ...p, y: p.y === 10 ? 30 : p.y }))],
      [ids[1]!, crossed.get(ids[1]!)!.map((p) => ({ ...p, y: p.y === 30 ? 10 : p.y }))],
    ])
    const tried: Map<string, EdgeRoutingHints>[] = []
    const best = await refinePortSwaps(ids, edgeMeta, anchors, routesOf(crossed), async (a) => {
      tried.push(new Map(a))
      return routesOf(uncrossed)
    })
    expect(tried).toHaveLength(1)
    expect(tried[0]!.get(ids[0]!)!.sourceAnchor).toEqual({ x: 0, y: 30 })
    expect(best.get(ids[0]!)!.sourcePoint).toEqual({ x: 0, y: 30 })
    // The accepted swap is written back into the caller's anchors.
    expect(anchors.get(ids[0]!)!.sourceAnchor).toEqual({ x: 0, y: 30 })
    expect(anchors.get(ids[1]!)!.sourceAnchor).toEqual({ x: 0, y: 10 })
  })

  it('discards a swap that does not lower the crossing count', async () => {
    const anchors = anchorsOf()
    const original = routesOf(crossed)
    let calls = 0
    const best = await refinePortSwaps(ids, edgeMeta, anchors, original, async () => {
      calls += 1
      return routesOf(crossed) // the swap leaves the crossing in place
    })
    expect(calls).toBe(1) // no gain → stop after the first trial
    expect(best).toBe(original)
    expect(anchors).toEqual(anchorsOf())
  })
})

describe('label anchors (labels.ts)', () => {
  const points = [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ]

  it('sits on the middle of the longest horizontal run by default', () => {
    expect(labelAnchorFor(points, {}, undefined, 20)).toEqual({ x: 100, y: 100 })
  })

  it('applies the persisted nudge in grid units, scaled by gridSize', () => {
    expect(labelAnchorFor(points, {}, { labelDx: 2, labelDy: -1 }, 20)).toEqual({ x: 140, y: 80 })
    expect(labelAnchorFor(points, {}, { labelDx: 2, labelDy: -1 }, 40)).toEqual({ x: 180, y: 60 })
  })
})

describe('port placement (anchors.ts)', () => {
  it('spreads a face evenly when no member can be straight', () => {
    expect(placePorts(0, 120, [undefined, undefined, undefined])).toEqual([20, 60, 100])
  })

  it('keeps a straight member on its coordinate and spreads the rest around it', () => {
    expect(placePorts(0, 120, [undefined, 90, undefined])).toEqual([30, 90, 110])
  })
})

describe('face cache lineage (faces.ts)', () => {
  const faces = new Map([['a->b#0', { s: 'E' as Side, t: 'W' as Side }]])
  const base = (): LayoutSidecar => ({
    gridSize: 20,
    nodes: { a: { cx: 2, cy: 2, w: 4, h: 2 }, b: { cx: 10, cy: 2, w: 4, h: 2 } },
    edges: {},
  })
  const warmed = (layout: LayoutSidecar) => {
    const cache = new FaceCache()
    cache.track(layout)
    cache.remember('sig', faces)
    return cache
  }

  it('keeps faces across in-editor edits (one map rebuilt, the other shared)', () => {
    const l0 = base()
    const cache = warmed(l0)
    const dragged = { ...l0, nodes: { ...l0.nodes, a: { ...l0.nodes.a!, cx: 3 } } }
    cache.track(dragged)
    const pinned = { ...dragged, edges: { 'a->b': { sourceSide: 'N' as Side } } }
    cache.track(pinned)
    cache.track({ ...pinned, textScale: 1.2 })
    expect(cache.lookup('sig')).toBe(faces)
    expect(cache.lookup('other-topology')).toBeUndefined()
  })

  it('drops faces when the layout is replaced wholesale', () => {
    const cache = warmed(base())
    cache.track(base()) // equal content, but freshly parsed: open / remote write
    expect(cache.lookup('sig')).toBeUndefined()
  })
})
