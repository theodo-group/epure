// The floating style panel exposes source/target face buttons for a selected
// edge; clicking one must pin that side in the layout sidecar (the router then
// honors it), and re-clicking clears back to auto.
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { parse } from '@/parser'
import { makeEdgeId } from '@/layout/elk'
import { useDiagramStore } from '@/store/diagramStore'

import { StylePanel } from './StylePanel'

const selectOneEdge = () => {
  const parsed = parse('a\nb\na -> b\n')
  if (!parsed.ok) throw new Error('parse failed')
  const id = makeEdgeId('a', 'b', 0)
  useDiagramStore.setState({
    parseResult: parsed,
    layout: {
      gridSize: 40,
      nodes: { a: { cx: 3, cy: 6, w: 4, h: 2 }, b: { cx: 12, cy: 6, w: 4, h: 2 } },
      edges: {},
    },
    selectedNodeIds: [],
    selectedAreaIds: [],
    selectedEdgeIds: [id],
  })
}

afterEach(cleanup)

describe('StylePanel edge faces', () => {
  it('shows Source/Target face controls for a selected edge', () => {
    selectOneEdge()
    render(<StylePanel />)
    expect(screen.getByText('Source face')).toBeTruthy()
    expect(screen.getByText('Target face')).toBeTruthy()
  })

  it('pins the source face on click and clears it on re-click', () => {
    selectOneEdge()
    render(<StylePanel />)
    // Each face control renders four buttons titled by direction; the Source row
    // is the first such group. Grab its "Top" (N) button.
    const tops = screen.getAllByTitle('Top')
    fireEvent.click(tops[0]!)
    expect(useDiagramStore.getState().layout.edges['a->b']?.sourceSide).toBe('N')

    // Re-click the now-explicit button → back to auto (undefined).
    fireEvent.click(screen.getAllByTitle('Top (click to reset)')[0]!)
    expect(useDiagramStore.getState().layout.edges['a->b']?.sourceSide).toBeUndefined()
  })

  it('pins the target face independently of the source face', () => {
    selectOneEdge()
    render(<StylePanel />)
    // Target row is the second face group → its "Right" (E) button is index 1.
    const rights = screen.getAllByTitle('Right')
    fireEvent.click(rights[1]!)
    expect(useDiagramStore.getState().layout.edges['a->b']?.targetSide).toBe('E')
    expect(useDiagramStore.getState().layout.edges['a->b']?.sourceSide).toBeUndefined()
  })
})
