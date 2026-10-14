// Title chips vs. edge ports: libavoid can't detour around a chip from a face
// that close, so ports stay out of a chip's shadow and a fully shadowed face
// gives way to a side face. The routing cases are the regression: an edge
// leaving a member upward used to be drawn straight through its own area's
// title chip.

import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { route } from './elk'
import type { EdgeMeta } from './faces'
import type { Rect } from './geometry'
import { normalizeForRoute } from './normalize'
import { chipReach, shadowsOn, unshadowFaces, usableRange } from './titleShadow'
import type { LayoutSidecar, RoutedDiagram } from './types'

const REACH = chipReach(20) // the default 40px grid's buffer
const node: Rect = { x: 180, y: 380, w: 160, h: 80 }

describe('shadowsOn', () => {
  it('shadows the span of a face a nearby chip overhangs, plus a margin', () => {
    const chip = { x: 170, y: 345, w: 55, h: 22 } // 13px above the top face
    expect(shadowsOn(node, 'N', [chip], REACH)).toEqual([[160, 235]])
  })

  it('ignores a chip beyond reach or behind the face', () => {
    const far = { x: 170, y: 380 - REACH - 22, w: 55, h: 22 }
    const below = { x: 170, y: 470, w: 55, h: 22 }
    expect(shadowsOn(node, 'N', [far, below], REACH)).toEqual([])
  })

  it('works for every face', () => {
    const right = { x: 350, y: 400, w: 30, h: 22 }
    expect(shadowsOn(node, 'E', [right], REACH)).toEqual([[390, 432]])
    expect(shadowsOn(node, 'W', [right], REACH)).toEqual([])
  })
})

describe('usableRange', () => {
  it('is the whole range when nothing overlaps it', () => {
    expect(usableRange(0, 100, [[200, 300]])).toEqual([0, 100])
  })

  it('keeps the longest unshadowed stretch', () => {
    expect(usableRange(0, 100, [[-10, 30]])).toEqual([30, 100])
    expect(usableRange(0, 100, [[20, 40]])).toEqual([40, 100])
    expect(usableRange(0, 100, [[60, 80]])).toEqual([0, 60])
  })

  it('is null when the range is all in shadow', () => {
    expect(
      usableRange(0, 100, [
        [-5, 50],
        [40, 110],
      ]),
    ).toBeNull()
  })
})

describe('unshadowFaces', () => {
  const narrow: Record<string, Rect> = {
    m: { x: 180, y: 380, w: 40, h: 40 },
    left: { x: 0, y: 140, w: 80, h: 40 },
    above: { x: 160, y: 140, w: 80, h: 40 },
  }
  const chip = { x: 170, y: 345, w: 55, h: 22 }
  const meta = (target: string, explicit = false): Map<string, EdgeMeta> =>
    new Map([
      [
        'e',
        {
          source: 'm',
          target,
          sourceSide: 'N',
          targetSide: 'S',
          explicitSource: explicit,
          explicitTarget: false,
        },
      ],
    ])

  it('moves a fully shadowed end to the side face towards the other end', () => {
    expect(unshadowFaces(meta('left'), narrow, [chip], REACH).get('e')!.sourceSide).toBe('W')
  })

  it('dead ahead, picks the side away from the chip', () => {
    // The chip leans left of the node's centre, so the edge leaves east.
    expect(unshadowFaces(meta('above'), narrow, [chip], REACH).get('e')!.sourceSide).toBe('E')
  })

  it('leaves a side the user pinned', () => {
    expect(unshadowFaces(meta('above', true), narrow, [chip], REACH).get('e')!.sourceSide).toBe('N')
  })

  it('returns the same map when no face is fully shadowed', () => {
    const m = meta('above')
    expect(unshadowFaces(m, narrow, [], REACH)).toBe(m)
    expect(unshadowFaces(m, { ...narrow, m: node }, [chip], REACH)).toBe(m)
  })
})

// The edges of `routed` that enter the chip of the area `areaId`.
const throughChip = (routed: RoutedDiagram, areaId: string, chip: Rect): string[] =>
  routed.edges
    .filter((e) =>
      e.points.slice(1).some((b, k) => {
        const a = e.points[k]!
        return (
          Math.max(a.x, b.x) > chip.x &&
          Math.min(a.x, b.x) < chip.x + chip.w &&
          Math.max(a.y, b.y) > chip.y &&
          Math.min(a.y, b.y) < chip.y + chip.h
        )
      }),
    )
    .map((e) => `${e.id} through ${areaId}`)

const routeOf = async (d2: string, nodes: LayoutSidecar['nodes'], edges = {}) => {
  const parsed = parse(d2)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
  const layout: LayoutSidecar = { gridSize: 40, nodes, edges }
  return route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
}

describe('routing around an area title', () => {
  // `A: "Alpha"` around one member: its chip spans x 170..225, y 345..367.
  const CHIP: Rect = { x: 170, y: 345, w: 55, h: 22 }

  it('routes a member edge leaving upward around its own area title', async () => {
    const routed = await routeOf('m\nt\nA: "Alpha" { m }\nm -> t\n', {
      m: { cx: 5, cy: 10, w: 1, h: 1 },
      t: { cx: 5, cy: 4, w: 2, h: 1 },
    })
    expect(throughChip(routed, 'A', CHIP)).toEqual([])
  })

  it('keeps a member with room beside the title on its top face', async () => {
    // x 160..240: the face centre (200) is under the chip, its right end isn't.
    const routed = await routeOf('m\nt\nA: "Alpha" { m }\nm -> t\n', {
      m: { cx: 5, cy: 10, w: 2, h: 1 },
      t: { cx: 5, cy: 4, w: 2, h: 1 },
    })
    const chip: Rect = { x: 150, y: 345, w: 55, h: 22 }
    expect(throughChip(routed, 'A', chip)).toEqual([])
    const start = routed.edges[0]!.points[0]!
    expect(start.y).toBe(380) // still leaves through the top face …
    expect(start.x).toBeGreaterThanOrEqual(chip.x + chip.w + 10) // … beside the title
  })

  it('arrives around the title too', async () => {
    const routed = await routeOf('m\nt\nA: "Alpha" { m }\nt -> m\n', {
      m: { cx: 5, cy: 10, w: 1, h: 1 },
      t: { cx: 5, cy: 4, w: 2, h: 1 },
    })
    expect(throughChip(routed, 'A', CHIP)).toEqual([])
  })
})
