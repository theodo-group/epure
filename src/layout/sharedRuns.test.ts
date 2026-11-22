// Two edges must never draw as one line. (Setup loads libavoid's real wasm, so
// these exercise production routing.)

import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { route } from './elk'
import type { Pt } from './geometry'
import { legRules, legsOf } from './legs'
import { normalizeForRoute } from './normalize'
import type { LayoutSidecar } from './types'

/** Pairs of different edges that share a run, as "edge / edge". */
const sharedRuns = (edges: Array<{ id: string; points: Pt[] }>, gridSize: number): string[] => {
  const { shareRun } = legRules(gridSize)
  const out: string[] = []
  edges.forEach((e, i) => {
    for (const f of edges.slice(i + 1)) {
      const hit = legsOf(e.points).some((a) => legsOf(f.points).some((b) => shareRun(a, b)))
      if (hit) out.push(`${e.id} / ${f.id}`)
    }
  })
  return out
}

const routeSource = async (source: string, layout: LayoutSidecar) => {
  const parsed = parse(source)
  if (!parsed.ok) throw new Error('parse failed')
  return route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))
}

describe('edges never share a line', () => {
  it('rounds two edges of different area groups onto different grid lines', async () => {
    // Six areas on a 3×2 grid; n1_0→n5_2 and n3_0→n5_0 are blocked by
    // different area sets, so they're routed in separate libavoid calls, which
    // packed them less than a cell apart; the grid snap then put them on one
    // vertical line between the areas.
    const source = [
      ...['n0_0', 'n1_0', 'n2_0', 'n2_1', 'n2_2', 'n3_0', 'n4_0', 'n4_1', 'n4_2'],
      ...['n5_0', 'n5_1', 'n5_2'],
      'n5_1 -> n2_2',
      'n1_0 -> n5_2',
      'n3_0 -> n5_0',
      'n4_1 -> n1_0',
      'A0: "Area 0" { n0_0 }',
      'A1: "Area 1" { n1_0 }',
      'A2: "Area 2" { n2_0; n2_1; n2_2 }',
      'A3: "Area 3" { n3_0 }',
      'A4: "Area 4" { n4_0; n4_1; n4_2 }',
      'A5: "Area 5" { n5_0; n5_1; n5_2 }',
      '',
    ].join('\n')
    const node = (cx: number, cy: number) => ({ cx, cy, w: 5, h: 2 })
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {
        n0_0: node(5, 4),
        n1_0: node(21, 4),
        n2_0: node(37, 4),
        n2_1: node(44, 4),
        n2_2: node(37, 8),
        n3_0: node(5, 16),
        n4_0: node(21, 16),
        n4_1: node(28, 16),
        n4_2: node(21, 20),
        n5_0: node(37, 16),
        n5_1: node(44, 16),
        n5_2: node(37, 20),
      },
      edges: {},
    }
    const routed = await routeSource(source, layout)
    expect(sharedRuns(routed.edges, 40)).toEqual([])
  })
})
