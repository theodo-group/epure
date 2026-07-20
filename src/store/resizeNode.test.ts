// resizeNode drags a single edge. For most shapes each axis is independent, but
// a `person` shape locks to a 1:1 ratio so the figure can never be stretched —
// the dragged edge sets one dimension and the perpendicular one follows.

import { beforeEach, describe, expect, it } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { useDiagramStore } from './diagramStore'

const GRID = 40
const layout = (): LayoutSidecar => ({
  gridSize: GRID,
  nodes: {
    p: { cx: 3, cy: 3, w: 2, h: 2 }, // person
    r: { cx: 3, cy: 3, w: 2, h: 2 }, // rectangle
  },
  edges: {},
})

const st = () => useDiagramStore.getState()

beforeEach(() => {
  st().loadDocument('p: P { shape: person }\nr: R\n', layout())
  // loadDocument swaps the source but doesn't reparse; resizeNode reads the
  // shape from parseResult, which the app keeps current via reparse().
  st().reparse()
})

describe('resizeNode', () => {
  it('keeps a person square when dragging the east edge', () => {
    // Drag the E edge out to grid column 7 (px = 7 * GRID).
    st().resizeNode('p', 'E', 7 * GRID, 0)
    const n = st().layout.nodes.p!
    expect(n.w).toBe(5)
    expect(n.h).toBe(5) // followed width, not left at 2
  })

  it('keeps a person square when dragging the south edge', () => {
    st().resizeNode('p', 'S', 0, 8 * GRID)
    const n = st().layout.nodes.p!
    expect(n.h).toBe(6)
    expect(n.w).toBe(6) // followed height
  })

  it('leaves a non-person free on the dragged axis only', () => {
    st().resizeNode('r', 'E', 7 * GRID, 0)
    const n = st().layout.nodes.r!
    expect(n.w).toBe(5)
    expect(n.h).toBe(2) // unchanged — no aspect lock
  })
})
