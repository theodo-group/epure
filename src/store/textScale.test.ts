// The global text zoom is a document property: it lives in the layout sidecar
// (`textScale`) so it persists with the pair, and 1 (the default) is omitted.

import { beforeEach, describe, expect, it } from 'vitest'

import { useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

beforeEach(() => {
  st().loadDocument('a\n', { gridSize: 40, nodes: {}, edges: {} })
})

describe('setTextScale', () => {
  it('writes the scale into the layout, rounded to whole percents', () => {
    st().setTextScale(1.15 * 1.15)
    expect(st().layout.textScale).toBe(1.32)
  })

  it('clamps to the schema bounds', () => {
    st().setTextScale(10)
    expect(st().layout.textScale).toBe(2.4)
    st().setTextScale(0.1)
    expect(st().layout.textScale).toBe(0.6)
  })

  it('drops the field when reset to 1', () => {
    st().setTextScale(1.5)
    st().setTextScale(1)
    expect('textScale' in st().layout).toBe(false)
  })

  it('is restored by loading a document that carries it', () => {
    st().loadDocument('a\n', { gridSize: 40, textScale: 0.8, nodes: {}, edges: {} })
    expect(st().layout.textScale).toBe(0.8)
  })
})
