// Edge routing constraints in the store: "Reset route" forgets pinned faces
// and waypoints (styling stays), and clearing a face through the style patch
// leaves no explicit undefined (nor an empty entry) behind in the sidecar.

import { describe, expect, it } from 'vitest'

import { useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

const load = () => {
  st().loadDocument('a\nb\nc\na -> b\nb -> c\n', {
    gridSize: 40,
    nodes: {
      a: { cx: 3, cy: 3, w: 4, h: 2 },
      b: { cx: 12, cy: 3, w: 4, h: 2 },
      c: { cx: 21, cy: 3, w: 4, h: 2 },
    },
    edges: {
      'a->b': { sourceSide: 'E', targetSide: 'W', via: [{ x: 8, y: 8 }], color: 'teal' },
      'b->c': { sourceSide: 'S', targetSide: 'N' },
    },
  })
  st().reparse()
}

describe('resetEdgeRoutes', () => {
  it('drops faces and waypoints of the selected edges, keeps their style', () => {
    load()
    st().setSelection([], [], ['a->b#0', 'b->c#1'])
    st().resetEdgeRoutes()
    expect(st().layout.edges['a->b']).toEqual({ color: 'teal' })
    // An entry with nothing left is removed outright.
    expect(st().layout.edges['b->c']).toBeUndefined()
  })

  it('leaves unselected edges alone', () => {
    load()
    st().setSelection([], [], ['a->b#0'])
    st().resetEdgeRoutes()
    expect(st().layout.edges['b->c']).toEqual({ sourceSide: 'S', targetSide: 'N' })
  })
})

describe('setEdgeStyle', () => {
  it('clears a face with undefined without leaving the key behind', () => {
    load()
    st().setSelection([], [], ['b->c#1'])
    st().setEdgeStyle({ sourceSide: undefined })
    expect(Object.keys(st().layout.edges['b->c']!)).toEqual(['targetSide'])
    st().setEdgeStyle({ targetSide: undefined })
    expect(st().layout.edges['b->c']).toBeUndefined()
  })
})
