import { describe, expect, it } from 'vitest'

import { computeCrossings } from './crossings'
import type { EdgeRoute } from './types'

const edge = (id: string, points: { x: number; y: number }[]): EdgeRoute => ({
  id,
  source: { nodeId: 'a', side: 'E' },
  target: { nodeId: 'b', side: 'W' },
  points,
})

describe('computeCrossings', () => {
  it('fades the under-edge where a horizontal and a vertical edge cross', () => {
    const h = edge('h', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
    const v = edge('v', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    const m = computeCrossings([h, v]) // h painted first → h is under
    expect(m.get('h')).toHaveLength(1)
    expect(m.get('h')![0]).toMatchObject({ x: 50, y: 50 })
    expect(m.get('v')).toBeUndefined() // the over-edge stays solid
  })

  it('puts the gap on whichever edge is painted first (the under-edge)', () => {
    const h = edge('h', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
    const v = edge('v', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    const m = computeCrossings([v, h]) // order flipped → v is under now
    expect(m.get('v')).toHaveLength(1)
    expect(m.get('h')).toBeUndefined()
  })

  it('sizes the gap from the over-edge stroke width', () => {
    const h = edge('h', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
    const v: EdgeRoute = {
      ...edge('v', [{ x: 50, y: 0 }, { x: 50, y: 100 }]),
      width: 'XL', // STROKE_WIDTH.XL = 4
    }
    const m = computeCrossings([h, v])
    expect(m.get('h')![0]!.r).toBe(7 + 4)
  })

  it('ignores edges meeting at a shared endpoint (a junction, not a crossing)', () => {
    const a = edge('a', [{ x: 0, y: 0 }, { x: 50, y: 0 }]) // ends at (50,0)
    const b = edge('b', [{ x: 50, y: 0 }, { x: 50, y: 50 }]) // starts at (50,0)
    expect(computeCrossings([a, b]).size).toBe(0)
  })

  it('ignores parallel, non-crossing edges', () => {
    const a = edge('a', [{ x: 0, y: 0 }, { x: 100, y: 0 }])
    const b = edge('b', [{ x: 0, y: 40 }, { x: 100, y: 40 }])
    expect(computeCrossings([a, b]).size).toBe(0)
  })

  it('finds the crossing on the horizontal leg of an L-bent edge', () => {
    const l = edge('l', [{ x: 0, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 120 }])
    const v = edge('v', [{ x: 40, y: 0 }, { x: 40, y: 60 }])
    const m = computeCrossings([l, v])
    expect(m.get('l')).toHaveLength(1)
    expect(m.get('l')![0]).toMatchObject({ x: 40, y: 20 })
  })

  it('records a gap per crossing when one edge passes under several', () => {
    const h = edge('h', [{ x: 0, y: 50 }, { x: 200, y: 50 }])
    const v1 = edge('v1', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    const v2 = edge('v2', [{ x: 150, y: 0 }, { x: 150, y: 100 }])
    const m = computeCrossings([h, v1, v2])
    expect(m.get('h')).toHaveLength(2)
  })
})
