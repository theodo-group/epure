// The inbound chokepoint: applyRemote must (a) create no undo entry, (b) never
// clear history on a reconnect, and (c) reset the burst window so the user's
// next local edit is independently undoable — the load-bearing flushBurst case.

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
const aCx = () => st().layout.nodes.a!.cx

beforeEach(() => {
  st().loadDocument('a\n', layoutWith(2)) // resets state + clears history
  flushBurst()
})

describe('applyRemote', () => {
  it('applies the remote layout without recording an undo entry', () => {
    expect(temporal().pastStates).toHaveLength(0)
    st().applyRemote({ layout: layoutWith(5) })
    expect(aCx()).toBe(5)
    expect(temporal().pastStates).toHaveLength(0)
  })

  it('applies source + layout together (reconnect hydrate shape)', () => {
    st().applyRemote({ source: 'a\nb\n', layout: layoutWith(9) })
    expect(st().source).toBe('a\nb\n')
    expect(aCx()).toBe(9)
  })

  it('does NOT clear existing undo history (a reconnect must not wipe the stack)', () => {
    st().moveNode('a', 3 * GRID, 2 * GRID) // a local edit → history grows
    const past = temporal().pastStates.length
    expect(past).toBeGreaterThan(0)
    st().applyRemote({ source: 'a\nb\n', layout: layoutWith(7) })
    expect(temporal().pastStates).toHaveLength(past) // preserved, not cleared
  })

  it('flushes the burst so a drag right after a remote apply is independently undoable', () => {
    // Open an undo burst with a local edit (snapshot of pre-move = {a.cx:2}).
    st().moveNode('a', 3 * GRID, 2 * GRID)
    expect(aCx()).toBe(3)
    // Remote apply lands (paused → no snapshot) and resets the burst.
    st().applyRemote({ layout: layoutWith(5) })
    expect(aCx()).toBe(5)
    // Immediate local drag — because the burst was flushed, this opens a FRESH
    // snapshot of the post-remote state {a.cx:5}.
    st().moveNode('a', 6 * GRID, 2 * GRID)
    expect(aCx()).toBe(6)
    // Undo must land on the post-remote layout, not the pre-everything one.
    temporal().undo()
    expect(aCx()).toBe(5)
  })
})
