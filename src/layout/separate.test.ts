// Edges routed in different libavoid calls (one per blocking-area group) are
// never nudged apart by libavoid; separateSharedRuns pulls the runs they share.
// These cases call the pass directly on hand-made routes; sharedRuns.test.ts
// covers it through route().

import { describe, expect, it } from 'vitest'

import type { AreaObstacle } from './areaGeometry'
import type { EdgeMeta } from './faces'
import type { Pt, Rect } from './geometry'
import { type Leg, legRules, legsOf } from './legs'
import { separateSharedRuns } from './separate'

const GRID = 40
const CLEARANCE = 20
const rules = legRules(GRID)

/** Pairs of different edges whose legs meet `relation`, as "edge / edge". */
const pairsWhere = (polys: Map<string, Pt[]>, relation: (a: Leg, b: Leg) => boolean): string[] => {
  const edges = [...polys]
  const out: string[] = []
  edges.forEach(([id, pts], i) => {
    for (const [other, otherPts] of edges.slice(i + 1)) {
      const hit = legsOf(pts).some((a) => legsOf(otherPts).some((b) => relation(a, b)))
      if (hit) out.push(`${id} / ${other}`)
    }
  })
  return out
}
const sharedRuns = (polys: Map<string, Pt[]>) => pairsWhere(polys, rules.shareRun)
const tightCrossings = (polys: Map<string, Pt[]>) => pairsWhere(polys, rules.crossNearCorner)

describe('separateSharedRuns', () => {
  // The channel between two areas from the diagram that surfaced the bug: three
  // edges into `ports` already fill lanes x=1600/1640/1680, and outcome→tables
  // (another group) was dropped on dryrun→ports' lane at x=1640.
  const nodes: Record<string, Rect> = {
    ports: { x: 1220, y: 980, w: 360, h: 120 },
    outcome: { x: 1220, y: 800, w: 360, h: 80 },
    issues: { x: 1700, y: 100, w: 360, h: 120 },
    dryrun: { x: 1700, y: 320, w: 360, h: 80 },
    repo: { x: 1700, y: 800, w: 360, h: 80 },
    tables: { x: 1700, y: 1180, w: 360, h: 120 },
  }
  const meta = (source: string, target: string) => ({ source, target }) as EdgeMeta
  const edgeMeta = new Map([
    ['issues->ports', meta('issues', 'ports')],
    ['dryrun->ports', meta('dryrun', 'ports')],
    ['repo->ports', meta('repo', 'ports')],
    ['outcome->tables', meta('outcome', 'tables')],
  ])
  const adapters: AreaObstacle = {
    id: 'Adapters',
    rect: { x: 1676, y: 76, w: 408, h: 1008 },
    members: new Set(['issues', 'dryrun', 'repo']),
  }
  const pts = (...xy: number[][]) => xy.map(([x, y]) => ({ x: x!, y: y! }))
  const c3Polys = () =>
    new Map([
      ['issues->ports', pts([1700, 136], [1600, 136], [1600, 1000], [1580, 1000])],
      ['dryrun->ports', pts([1700, 360], [1640, 360], [1640, 1040], [1580, 1040])],
      ['repo->ports', pts([1700, 840], [1680, 840], [1680, 1080], [1580, 1080])],
      ['outcome->tables', pts([1400, 880], [1400, 920], [1640, 920], [1640, 1240], [1700, 1240])],
    ])

  it('slides one edge to a free lane, keeping the other edges in place', () => {
    const polys = c3Polys()
    separateSharedRuns({
      polys: polys,
      edgeMeta: edgeMeta,
      nodes: nodes,
      obstacles: [adapters],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(sharedRuns(polys)).toEqual([])
    expect(polys.get('issues->ports')).toEqual(c3Polys().get('issues->ports'))
    expect(polys.get('repo->ports')).toEqual(c3Polys().get('repo->ports'))
  })

  it('pulls a crossing away from the corner it sits next to', () => {
    // a and b cross twice, each time 20px from a corner (b's horizontal just
    // before b turns, b's vertical just after a turns): both crossing gaps land
    // next to a corner and read as broken stubs.
    const polys = new Map([
      ['a', pts([0, 0], [100, 0], [100, 200], [200, 200])],
      ['b', pts([-100, 100], [120, 100], [120, 300], [300, 300])],
    ])
    const free = new Map([
      ['a', meta('a0', 'a1')],
      ['b', meta('b0', 'b1')],
    ])
    expect(tightCrossings(polys)).toHaveLength(1)
    separateSharedRuns({
      polys: polys,
      edgeMeta: free,
      nodes: {},
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(tightCrossings(polys)).toEqual([])
    expect(sharedRuns(polys)).toEqual([])
  })

  it('still slides a leg when another leg of the edge already sits within the clearance', () => {
    // e's first leg (x=0) runs 5 px right of node f and does not move; it must
    // not block sliding e's vertical off o's line at x=200.
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const scene: Record<string, Rect> = {
      es: { x: -40, y: -40, w: 80, h: 40 },
      et: { x: 300, y: 260, w: 80, h: 80 },
      f: { x: -100, y: 20, w: 95, h: 60 },
    }
    const polys = new Map([
      ['o', pts([200, 50], [200, 350])],
      ['e', pts([0, 0], [0, 100], [200, 100], [200, 300], [300, 300])],
    ])
    const metas = new Map([
      ['o', sided('os', 'ot', 'S', 'N')],
      ['e', sided('es', 'et', 'S', 'W')],
    ])
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: scene,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(sharedRuns(polys)).toEqual([])
    expect(polys.get('o')).toEqual(pts([200, 50], [200, 350]))
    expect(polys.get('e')![0]).toEqual({ x: 0, y: 0 })
  })

  it('does not slide a leg onto a lane that runs closer than the clearance to a node', () => {
    // e shares x=200 with o. Lanes 180 and 220 pass 5 px from nodes l and r
    // without crossing them; every other lane crosses one of them.
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const scene: Record<string, Rect> = {
      es: { x: -40, y: -40, w: 80, h: 40 },
      et: { x: 300, y: 260, w: 80, h: 80 },
      l: { x: 60, y: 120, w: 115, h: 160 },
      r: { x: 225, y: 120, w: 115, h: 160 },
    }
    const e = pts([0, 0], [0, 100], [200, 100], [200, 300], [300, 300])
    const polys = new Map([
      ['o', pts([200, 50], [200, 350])],
      ['e', e],
    ])
    const metas = new Map([
      ['o', sided('os', 'ot', 'S', 'N')],
      ['e', sided('es', 'et', 'S', 'W')],
    ])
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: scene,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(polys.get('e')).toEqual(e)
  })

  it('leaves a run alone when every lane is blocked', () => {
    // A shape over the whole channel that blocks every edge (no members, like
    // a title chip): no lane keeps its clearance.
    const wall: AreaObstacle = {
      id: 'wall',
      rect: { x: 1585, y: 300, w: 110, h: 1000 },
      members: new Set(),
    }
    const polys = c3Polys()
    separateSharedRuns({
      polys: polys,
      edgeMeta: edgeMeta,
      nodes: nodes,
      obstacles: [wall],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(polys).toEqual(c3Polys())
  })
  it('moves a port along its face when two aligned nodes put their exit legs on one line', () => {
    // n0_2 and n2_2 have the same centre height, so both edges leave at y=320
    // and share it from x=680 to 1120 — on their FIRST legs, held by the ports.
    const aligned: Record<string, Rect> = {
      n0_2: { x: 100, y: 280, w: 200, h: 80 },
      n2_2: { x: 1380, y: 280, w: 200, h: 80 },
      n4_1: { x: 1020, y: 600, w: 200, h: 80 },
      n3_2: { x: 100, y: 760, w: 200, h: 80 },
    }
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const metas = new Map([
      ['n2_2->n3_2', sided('n2_2', 'n3_2', 'W', 'E')],
      ['n0_2->n4_1', sided('n0_2', 'n4_1', 'E', 'N')],
    ])
    const polys = new Map([
      ['n2_2->n3_2', pts([1380, 320], [680, 320], [680, 800], [300, 800])],
      ['n0_2->n4_1', pts([300, 320], [1120, 320], [1120, 600])],
    ])
    separateSharedRuns({
      polys: polys,
      edgeMeta: metas,
      nodes: aligned,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(sharedRuns(polys)).toEqual([])
    // Each edge still starts on its own node's face, inside its height.
    const [a, b] = [polys.get('n2_2->n3_2')![0]!, polys.get('n0_2->n4_1')![0]!]
    expect(a.x).toBe(1380)
    expect(b.x).toBe(300)
    for (const p of [a, b]) {
      expect(p.y).toBeGreaterThan(280)
      expect(p.y).toBeLessThan(360)
    }
  })
  it('never slides a leg next to or through the edge’s own end node', () => {
    // a leaves s eastward with a 30 px end leg, then runs down x=130 on b's
    // line. A wall blocks every lane to the right; every lane to the left
    // would shorten a's end leg below the clearance or run through s.
    const s = { x: 0, y: 0, w: 100, h: 100 }
    const own: Record<string, Rect> = {
      s,
      t: { x: 300, y: 260, w: 100, h: 80 },
      wall: { x: 140, y: 100, w: 160, h: 150 },
      bs: { x: 100, y: 500, w: 60, h: 40 },
      bt: { x: 100, y: -100, w: 60, h: 40 },
    }
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const metas = new Map([
      ['b', sided('bs', 'bt', 'N', 'S')],
      ['a', sided('s', 't', 'E', 'W')],
    ])
    const polys = new Map([
      ['b', pts([130, 500], [130, -60])],
      ['a', pts([100, 50], [130, 50], [130, 300], [300, 300])],
    ])
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: own,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    const a = polys.get('a')!
    expect(a[1]!.x - a[0]!.x).toBeGreaterThanOrEqual(CLEARANCE)
    const legsInsideS = legsOf(a.slice(1, -1)).filter(
      (l) => l.axis === 'V' && l.coord > s.x && l.coord < s.x + s.w && l.lo < s.y + s.h,
    )
    expect(legsInsideS).toEqual([])
  })

  it('changes nothing when run again on its own output', () => {
    const polys = c3Polys()
    const scene = {
      polys,
      edgeMeta,
      nodes,
      obstacles: [adapters],
      gridSize: GRID,
      clearance: CLEARANCE,
    }
    separateSharedRuns(scene)
    expect(polys).not.toEqual(c3Polys())
    const once = new Map(polys)
    separateSharedRuns(scene)
    expect(polys).toEqual(once)
  })

  it('never slides a port so that the first leg runs through the target node', () => {
    // a leaves s southward at x=60 and comes back up into t's east face; the
    // other edges hold x=20…100. Sliding a's port to x=120 would clear the run
    // but take its first leg through t (x 100..180, y 120..160).
    const t = { x: 100, y: 120, w: 80, h: 40 }
    const scene: Record<string, Rect> = { s: { x: 0, y: 0, w: 200, h: 80 }, t }
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const blockers = [20, 40, 60, 80, 100].map((x) => [`b${x}`, pts([x, 60], [x, 260])] as const)
    const polys = new Map<string, Pt[]>([
      ...blockers,
      ['a', pts([60, 80], [60, 240], [300, 240], [300, 140], [180, 140])],
    ])
    const metas = new Map<string, EdgeMeta>([
      ...blockers.map(([id]) => [id, sided(`${id}s`, `${id}t`, 'S', 'N')] as const),
      ['a', sided('s', 't', 'S', 'E')],
    ])
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: scene,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    const a = polys.get('a')!
    const firstLeg = legsOf(a.slice(0, 2))[0]!
    const throughT =
      firstLeg.coord > t.x &&
      firstLeg.coord < t.x + t.w &&
      firstLeg.hi > t.y &&
      firstLeg.lo < t.y + t.h
    expect(throughT).toBe(false)
  })

  it('never trades a shared run with one edge for a shared run with another', () => {
    // From a generated diagram: e runs 18.67 px from #1 (a shared run). Sliding
    // its target port from y=160 to y=140 clears that run and a tight
    // crossing, but lands e exactly on #7's leg at y=140.44 over 520 px.
    const others: Array<[string, number[][]]> = [
      [
        '#0',
        [
          [1560, 1280],
          [1560, 800],
          [880, 800],
          [880, 89.33],
          [560, 89.33],
        ],
      ],
      [
        '#1',
        [
          [360, 1120],
          [360, 178.67],
          [280, 178.67],
        ],
      ],
      [
        '#2',
        [
          [300, 420],
          [720, 420],
          [720, 280],
          [1680, 280],
          [1680, 200],
        ],
      ],
      [
        '#3',
        [
          [1120, 1220],
          [840, 1220],
          [840, 109.33],
          [560, 109.33],
        ],
      ],
      [
        '#4',
        [
          [1120, 180.44],
          [680, 180.44],
          [680, 380],
          [300, 380],
        ],
      ],
      [
        '#6',
        [
          [440, 1360],
          [200, 1360],
          [200, 440],
        ],
      ],
      [
        '#7',
        [
          [280, 140.44],
          [1120, 140.44],
        ],
      ],
      [
        '#8',
        [
          [560, 61.33],
          [900, 61.33],
          [900, 360],
          [1180, 360],
        ],
      ],
    ]
    const polys = new Map<string, Pt[]>([
      ...others.map(([id, xy]) => [id, pts(...xy)] as const),
      ['e', pts([1120, 1260], [800, 1260], [800, 160], [280, 160])],
    ])
    const sided = (source: string, target: string, sourceSide: string, targetSide: string) =>
      ({ source, target, sourceSide, targetSide }) as EdgeMeta
    const metas = new Map<string, EdgeMeta>([
      ...others.map(([id]) => [id, sided(`${id}s`, `${id}t`, 'N', 'S')] as const),
      ['e', sided('es', 'et', 'W', 'E')],
    ])
    const own: Record<string, Rect> = {
      es: { x: 1120, y: 1220, w: 80, h: 80 },
      et: { x: 200, y: 100, w: 80, h: 120 },
    }
    expect(
      pairsWhere(
        new Map([
          ['e', polys.get('e')!],
          ['#7', polys.get('#7')!],
        ]),
        rules.shareRun,
      ),
    ).toEqual([])
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: own,
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    expect(sharedRuns(polys).filter((p) => p.includes('e /') || p.endsWith('/ e'))).not.toContain(
      '#7 / e',
    )
  })

  it('never adds a second shared run with an edge it already shares one with', () => {
    // m shares a run with p (y=800 beside y=796) and crosses q1 and q2 next to
    // its corner. Sliding m's vertical to x=680 clears both tight crossings
    // but lays it on p's vertical: two runs with p instead of one. Node w
    // blocks the lanes right of x=680.
    const polys = new Map([
      ['p', pts([160, 796], [680, 796], [680, 316])],
      ['q1', pts([300, 740], [670, 740])],
      ['q2', pts([300, 770], [670, 770])],
      ['m', pts([160, 800], [560, 800], [560, 714], [800, 714])],
    ])
    const metas = new Map(
      [...polys.keys()].map((id) => [id, { source: `${id}s`, target: `${id}t` } as EdgeMeta]),
    )
    separateSharedRuns({
      polys,
      edgeMeta: metas,
      nodes: { w: { x: 705, y: 740, w: 85, h: 50 } },
      obstacles: [],
      gridSize: GRID,
      clearance: CLEARANCE,
    })
    const runsWithP = legsOf(polys.get('m')!).flatMap((a) =>
      legsOf(polys.get('p')!).filter((b) => rules.shareRun(a, b)),
    )
    expect(runsWithP.length).toBeLessThanOrEqual(1)
  })
})
