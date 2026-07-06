// moveNodes is an upsert: it moves already-pinned nodes AND materializes ones
// that have no sidecar entry yet (an auto-placed group member). Without the
// latter, dragging a freshly-typed group moved nothing — the reported bug.

import { beforeEach, describe, expect, it } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { useDiagramStore } from './diagramStore'

const GRID = 40
const layout = (): LayoutSidecar => ({
  gridSize: GRID,
  nodes: { a: { cx: 3, cy: 3, w: 5, h: 2 } }, // 'a' pinned; 'b' absent
  edges: {},
})

const st = () => useDiagramStore.getState()

beforeEach(() => {
  st().loadDocument('a\nb\n', layout())
})

describe('moveNodes', () => {
  it('moves an existing node while preserving its size', () => {
    st().moveNodes({ a: { cx: 10, cy: 12 } })
    expect(st().layout.nodes.a).toEqual({ cx: 10, cy: 12, w: 5, h: 2 })
  })

  it('materializes a not-yet-pinned member at the passed size', () => {
    st().moveNodes({ b: { cx: 8, cy: 9, w: 4, h: 2 } })
    expect(st().layout.nodes.b).toEqual({ cx: 8, cy: 9, w: 4, h: 2 })
  })

  it('falls back to the canonical default size when none is given', () => {
    st().moveNodes({ b: { cx: 1, cy: 1 } })
    expect(st().layout.nodes.b).toEqual({ cx: 1, cy: 1, w: 4, h: 2 })
  })

  it('moves a batch of pinned and unpinned nodes together (area drag)', () => {
    st().moveNodes({
      a: { cx: 5, cy: 5, w: 5, h: 2 },
      b: { cx: 11, cy: 5, w: 4, h: 2 },
    })
    expect(st().layout.nodes.a).toMatchObject({ cx: 5, cy: 5 })
    expect(st().layout.nodes.b).toMatchObject({ cx: 11, cy: 5 })
  })
})
