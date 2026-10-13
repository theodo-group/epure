// Open replaces the document as ONE undo step: undo brings the previous diagram
// back (unlike loadDocument, which is a fresh baseline), and an edit burst in
// progress is neither folded into the open nor merged with the next edit.

import { beforeEach, describe, expect, it } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { flushBurst, useDiagramStore } from './diagramStore'

const GRID = 40
const layoutWith = (cx: number): LayoutSidecar => ({
  gridSize: GRID,
  nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
  edges: {},
})

const st = () => useDiagramStore.getState()
const temporal = () => useDiagramStore.temporal.getState()

beforeEach(() => {
  st().loadDocument('a\n', layoutWith(2)) // resets state + clears history
  flushBurst()
})

describe('openDocument', () => {
  it('replaces the document and undo brings the previous one back', () => {
    st().openDocument('b -> c\n', layoutWith(9))
    expect(st().source).toBe('b -> c\n')
    temporal().undo()
    expect(st().source).toBe('a\n')
    expect(st().layout).toEqual(layoutWith(2))
    temporal().redo()
    expect(st().source).toBe('b -> c\n')
  })

  it('does not fold an edit burst in progress into the open', () => {
    st().moveNode('a', 5 * GRID, 2 * GRID) // opens a burst (snapshot: cx 2)
    st().openDocument('b\n', layoutWith(9))
    temporal().undo() // back to the moved document, not past it
    expect(st().source).toBe('a\n')
    expect(st().layout.nodes.a!.cx).toBe(5)
  })

  it('starts a fresh undo step for the first edit after the open', () => {
    st().openDocument('a\n', layoutWith(9))
    st().moveNode('a', 4 * GRID, 2 * GRID)
    temporal().undo() // undoes only the move
    expect(st().layout.nodes.a!.cx).toBe(9)
  })

  it('clears the selection of the previous document', () => {
    st().setSelection(['a'], [])
    st().openDocument('b\n', layoutWith(9))
    expect(st().selectedNodeIds).toEqual([])
  })
})
