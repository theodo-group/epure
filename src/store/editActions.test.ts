// The store's small editing actions, driven through the public store API: each
// test pins what the action writes to the layout sidecar (the file the user
// commits) or to the selection.

import { beforeEach, describe, expect, it } from 'vitest'

import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'

import { useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

const SOURCE = 'a\nb\nc\na -> b\na -> b\nb -> c\nG: Group {\n  a\n}\n'
const layout = (): LayoutSidecar => ({
  gridSize: 40,
  nodes: {
    a: { cx: 5, cy: 5, w: 4, h: 2 },
    b: { cx: 12, cy: 5, w: 4, h: 2 },
  },
  edges: {},
})

// What the router publishes for SOURCE: two parallel a->b edges and one b->c.
const routedEdges = (...ids: string[]): RoutedDiagram => ({
  gridSize: 40,
  nodes: [],
  areas: [],
  edges: ids.map((id) => ({
    id,
    source: { nodeId: id[0]!, side: 'E' },
    target: { nodeId: id[3]!, side: 'W' },
    points: [],
  })),
})

beforeEach(() => {
  st().loadDocument(SOURCE, layout())
  st().reparse()
  useDiagramStore.setState({ routed: routedEdges('a->b#0', 'a->b#1', 'b->c#2') })
})

describe('resizeNode', () => {
  it('never shrinks a node below one grid cell, whichever edge is dragged past the other', () => {
    // a spans x 3..7, y 4..6 (grid units).
    st().resizeNode('a', 'E', 1 * 40, 0) // right edge dragged left of the left edge
    expect(st().layout.nodes.a).toEqual({ cx: 3.5, cy: 5, w: 1, h: 2 })

    st().loadDocument(SOURCE, layout())
    st().resizeNode('a', 'W', 20 * 40, 0) // left edge dragged right of the right edge
    expect(st().layout.nodes.a).toEqual({ cx: 6.5, cy: 5, w: 1, h: 2 })

    st().loadDocument(SOURCE, layout())
    st().resizeNode('a', 'S', 0, 0) // bottom edge dragged above the top
    expect(st().layout.nodes.a).toEqual({ cx: 5, cy: 4.5, w: 4, h: 1 })

    st().loadDocument(SOURCE, layout())
    st().resizeNode('a', 'N', 0, 20 * 40) // top edge dragged below the bottom
    expect(st().layout.nodes.a).toEqual({ cx: 5, cy: 5.5, w: 4, h: 1 })
  })

  it('keeps the opposite edge fixed and snaps the dragged one to the grid', () => {
    st().resizeNode('a', 'N', 0, 1.4 * 40) // top → row 1, bottom stays at 6
    expect(st().layout.nodes.a).toEqual({ cx: 5, cy: 3.5, w: 4, h: 5 })
  })
})

describe('selectEdge', () => {
  it('selects every parallel edge sharing the clicked edge’s style key', () => {
    st().selectNode('a')
    st().selectEdge('a->b#1')
    expect(st().selectedEdgeIds).toEqual(['a->b#0', 'a->b#1'])
    expect(st().selectedNodeIds).toEqual([])
  })

  it('adds and removes a whole sibling group on an additive click', () => {
    st().selectEdge('b->c#2')
    st().selectEdge('a->b#0', true)
    expect(st().selectedEdgeIds).toEqual(['b->c#2', 'a->b#0', 'a->b#1'])
    st().selectEdge('a->b#1', true) // group fully selected → toggles off
    expect(st().selectedEdgeIds).toEqual(['b->c#2'])
  })

  it('falls back to the clicked id before anything is routed, and clears on undefined', () => {
    useDiagramStore.setState({ routed: null })
    st().selectEdge('a->b#1')
    expect(st().selectedEdgeIds).toEqual(['a->b#1'])
    st().selectEdge(undefined)
    expect(st().selectedEdgeIds).toEqual([])
  })
})

describe('setGridSize', () => {
  it('rounds to whole pixels and never goes below 2, in the store and the sidecar', () => {
    st().setGridSize(23.6)
    expect([st().gridSize, st().layout.gridSize]).toEqual([24, 24])
    st().setGridSize(0)
    expect([st().gridSize, st().layout.gridSize]).toEqual([2, 2])
    st().setGridSize(-40)
    expect(st().layout.gridSize).toBe(2)
  })
})

describe('setEdgeSide', () => {
  it('pins one end, defaulting a new entry to the east→west faces', () => {
    st().setEdgeSide('a->b', 'target', 'N')
    expect(st().layout.edges['a->b']).toEqual({ sourceSide: 'E', targetSide: 'N' })
    st().setEdgeSide('a->b', 'source', 'S')
    expect(st().layout.edges['a->b']).toEqual({ sourceSide: 'S', targetSide: 'N' })
  })

  it('keeps the entry’s styling when pinning a side', () => {
    st().setLayout({ ...layout(), edges: { 'b->c': { color: 'red', width: 'L' } } })
    st().setEdgeSide('b->c', 'source', 'W')
    expect(st().layout.edges['b->c']).toMatchObject({ color: 'red', width: 'L', sourceSide: 'W' })
  })
})

describe('setNodeSize', () => {
  it('resizes in place, keeping position and style', () => {
    st().setLayout({
      ...layout(),
      nodes: { a: { cx: 5, cy: 5, w: 4, h: 2, fillColor: 'blue' } },
    })
    st().setNodeSize('a', 6, 3)
    expect(st().layout.nodes.a).toEqual({ cx: 5, cy: 5, w: 6, h: 3, fillColor: 'blue' })
  })

  it('materialises an unplaced node at the origin', () => {
    st().setNodeSize('c', 2, 2)
    expect(st().layout.nodes.c).toEqual({ cx: 0, cy: 0, w: 2, h: 2 })
  })
})

describe('style actions', () => {
  it('setNodeStyle merges into every selected placed node, and only those', () => {
    st().setSelection(['a', 'b', 'c'], [])
    st().setNodeStyle({ fillColor: 'green' })
    st().setSelection(['a'], [])
    st().setNodeStyle({ textColor: 'red' })
    const { nodes } = st().layout
    expect(nodes.a).toEqual({ cx: 5, cy: 5, w: 4, h: 2, fillColor: 'green', textColor: 'red' })
    expect(nodes.b).toEqual({ cx: 12, cy: 5, w: 4, h: 2, fillColor: 'green' })
    // An unplaced node gets no entry (a style must not invent a position).
    expect(nodes.c).toBeUndefined()
  })

  it('setEdgeStyle writes one entry per source->target, shared by parallel edges', () => {
    st().setSelection([], [], ['a->b#1', 'b->c#2'])
    st().setEdgeStyle({ lineStyle: 'dashed' })
    st().setSelection([], [], ['a->b#0'])
    st().setEdgeStyle({ color: 'blue' })
    expect(st().layout.edges).toEqual({
      'a->b': { lineStyle: 'dashed', color: 'blue' },
      'b->c': { lineStyle: 'dashed' },
    })
  })

  it('setAreaStyle merges into the selected areas', () => {
    st().setSelection([], ['G'])
    st().setAreaStyle({ fillColor: 'purple' })
    st().setAreaStyle({ borderStyle: 'solid' })
    expect(st().layout.areas).toEqual({ G: { fillColor: 'purple', borderStyle: 'solid' } })
  })

  it('leaves the document untouched when nothing of that kind is selected', () => {
    st().selectNode(undefined)
    const before = st().layout
    st().setNodeStyle({ fillColor: 'green' })
    st().setEdgeStyle({ color: 'red' })
    st().setAreaStyle({ fillColor: 'purple' })
    expect(st().layout).toBe(before)
  })
})

describe('setEdgeLabelOffset', () => {
  it('stores a nudge per source->target and drops each axis that returns to 0', () => {
    st().setEdgeLabelOffset('a->b#1', 1.5, -2)
    expect(st().layout.edges['a->b']).toEqual({ labelDx: 1.5, labelDy: -2 })
    st().setEdgeLabelOffset('a->b#0', 0, -2)
    expect(st().layout.edges['a->b']).toEqual({ labelDy: -2 })
    st().setEdgeLabelOffset('a->b#0', 0, 0)
    expect(st().layout.edges).not.toHaveProperty('a->b')
  })

  it('clearing the nudge keeps the edge’s other styling', () => {
    st().setLayout({ ...layout(), edges: { 'a->b': { color: 'red', labelDx: 1 } } })
    st().setEdgeLabelOffset('a->b#0', 0, 0)
    expect(st().layout.edges['a->b']).toEqual({ color: 'red' })
  })
})
