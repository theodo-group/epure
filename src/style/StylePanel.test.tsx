// @vitest-environment jsdom
//
// The floating style panel exposes source/target face buttons for a selected
// edge; clicking one must pin that side in the layout sidecar (the router then
// honors it), and re-clicking clears back to auto.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { parse } from '@/parser'
import { makeEdgeId } from '@/layout/ids'
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

const edgeEntry = () => useDiagramStore.getState().layout.edges['a->b']
const faceButton = (row: 'Source face' | 'Target face', side: string) =>
  within(screen.getByRole('group', { name: row })).getByRole('button', { name: side })

afterEach(cleanup)

describe('StylePanel edge faces', () => {
  it('shows Source/Target face controls with the four sides each', () => {
    selectOneEdge()
    render(<StylePanel />)
    for (const row of ['Source face', 'Target face'] as const) {
      const sides = within(screen.getByRole('group', { name: row })).getAllByRole('button')
      expect(sides.map((b) => b.getAttribute('title'))).toEqual(['Top', 'Right', 'Bottom', 'Left'])
    }
  })

  it('pins the source face on click and clears it on re-click', () => {
    selectOneEdge()
    render(<StylePanel />)
    fireEvent.click(faceButton('Source face', 'Top'))
    expect(edgeEntry()?.sourceSide).toBe('N')
    expect(edgeEntry()?.targetSide).toBeUndefined()

    // Re-click the now-explicit button → back to auto (undefined).
    fireEvent.click(faceButton('Source face', 'Top (click to reset)'))
    expect(edgeEntry()?.sourceSide).toBeUndefined()
  })

  it('pins the target face independently of the source face', () => {
    selectOneEdge()
    render(<StylePanel />)
    fireEvent.click(faceButton('Target face', 'Right'))
    expect(edgeEntry()?.targetSide).toBe('E')
    expect(edgeEntry()?.sourceSide).toBeUndefined()
  })
})
