// Format rewrites the .d2 as ONE undo step through the plain source path, and
// is a true no-op (no undo entry, no store write) when there is nothing to do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { flushBurst, useDiagramStore } from './diagramStore'

const layout: LayoutSidecar = { gridSize: 40, nodes: {}, edges: {} }
const MESSY = 'a -> b\nb   :  "B"\na\n'
const FORMATTED = 'b: "B"\na\n\na -> b\n'

const st = () => useDiagramStore.getState()
const temporal = () => useDiagramStore.temporal.getState()

beforeEach(() => {
  vi.useFakeTimers()
  st().loadDocument(MESSY, layout)
  flushBurst()
})
afterEach(() => {
  flushBurst()
  vi.useRealTimers()
})

describe('formatSource', () => {
  it('rewrites the source in canonical form, and one undo restores it', () => {
    expect(st().formatSource()).toBe(true)
    expect(st().source).toBe(FORMATTED)
    expect(temporal().pastStates).toHaveLength(1)
    temporal().undo()
    expect(st().source).toBe(MESSY)
  })

  it('is its own undo step: not folded into a typing burst, not merged with the next edit', () => {
    st().setSource(`${MESSY}c\n`) // a keystroke burst in progress
    st().formatSource()
    st().setSource(`${FORMATTED}d\n`) // the next edit, inside the burst window
    temporal().undo()
    expect(st().source).toBe('b: "B"\na\nc\n\na -> b\n')
    temporal().undo()
    expect(st().source).toBe(`${MESSY}c\n`)
  })

  it('is a no-op on an already formatted source: no undo entry, no store write', () => {
    st().loadDocument(FORMATTED, layout)
    const writes = vi.fn()
    const unsub = useDiagramStore.subscribe(writes)
    expect(st().formatSource()).toBe(false)
    unsub()
    expect(writes).not.toHaveBeenCalled()
    expect(temporal().pastStates).toHaveLength(0)
  })

  it('does nothing when the source does not parse', () => {
    st().loadDocument('a -> \n', layout)
    expect(st().formatSource()).toBe(false)
    expect(st().source).toBe('a -> \n')
    expect(temporal().pastStates).toHaveLength(0)
  })
})
