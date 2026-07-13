// deleteSelection removes the selected nodes/edges/areas from BOTH the .d2 and
// the layout sidecar in one step. The load-bearing behaviours: deleting a node
// cascades to every incident edge (a dangling edge would render a phantom box)
// and strips the node from surviving group blocks; deleting an area removes only
// the grouping; and whole lines are removed cleanly (no blank lines / dangling
// indent left behind).

import { beforeEach, describe, expect, it } from 'vitest'

import type { Diagram } from '@/parser/ast'
import type { LayoutSidecar } from '@/layout/types'

import { flushBurst, useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

const SOURCE = ['a', 'b', 'c', 'a -> b', 'b -> c', 'group: "G" {', '  a', '  b', '}', ''].join(
  '\n',
)

const layout = (): LayoutSidecar => ({
  gridSize: 40,
  nodes: {
    a: { cx: 1, cy: 1, w: 4, h: 2 },
    b: { cx: 6, cy: 1, w: 4, h: 2 },
    c: { cx: 11, cy: 1, w: 4, h: 2 },
  },
  edges: { 'a->b': { labelDx: 1 }, 'b->c': {} },
  areas: { group: {} },
})

const diagram = (): Diagram => {
  const r = st().parseResult
  if (!r.ok) throw new Error('expected a valid parse')
  return r.diagram
}
const ids = (ns: { id: string }[]) => ns.map((n) => n.id).sort()
const edgeKeys = (es: { source: string; target: string }[]) =>
  es.map((e) => `${e.source}->${e.target}`).sort()

beforeEach(() => {
  st().loadDocument(SOURCE, layout())
  st().reparse()
  // Reset the cross-test undo-burst window so each test's first edit opens a
  // fresh, independently-undoable snapshot (the burst state is module-level).
  flushBurst()
})

describe('deleteSelection', () => {
  it('deletes a node, cascades incident edges, and strips it from groups', () => {
    st().setSelectedNodeIds(['b'])
    st().deleteSelection()

    // Source: b's line, both edges touching b, and the `b` member line are gone —
    // with no blank line or dangling indent left behind.
    expect(st().source).toBe(['a', 'c', 'group: "G" {', '  a', '}', ''].join('\n'))

    st().reparse()
    expect(ids(diagram().nodes)).toEqual(['a', 'c'])
    expect(diagram().edges).toHaveLength(0)
    expect(diagram().areas[0]!.members).toEqual(['a'])
    // Layout cleaned to match.
    expect(st().layout.nodes).not.toHaveProperty('b')
    expect(st().layout.edges).toEqual({})
    // Selection cleared.
    expect(st().selectedNodeIds).toEqual([])
  })

  it('deletes only the selected edge, leaving its endpoints', () => {
    st().setSelectedEdgeIds(['a->b#0'])
    st().deleteSelection()
    st().reparse()

    expect(ids(diagram().nodes)).toEqual(['a', 'b', 'c'])
    expect(edgeKeys(diagram().edges)).toEqual(['b->c'])
    expect(st().layout.edges).toEqual({ 'b->c': {} })
  })

  it('deletes an area but keeps its member nodes and edges', () => {
    st().setSelectedAreaIds(['group'])
    st().deleteSelection()
    st().reparse()

    expect(diagram().areas).toHaveLength(0)
    expect(ids(diagram().nodes)).toEqual(['a', 'b', 'c'])
    expect(edgeKeys(diagram().edges)).toEqual(['a->b', 'b->c'])
    expect(st().layout.areas).toEqual({})
  })

  it('is a no-op with an empty selection', () => {
    st().clearSelection()
    const before = st().source
    st().deleteSelection()
    expect(st().source).toBe(before)
  })

  it('makes the delete undoable in one step', () => {
    st().setSelectedNodeIds(['a'])
    st().deleteSelection()
    expect(st().source).not.toBe(SOURCE)
    useDiagramStore.temporal.getState().undo()
    expect(st().source).toBe(SOURCE)
    expect(st().layout.nodes).toHaveProperty('a')
  })
})
