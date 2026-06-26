import { describe, expect, it } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'

import { contentKey, isValid, layoutToText } from './sync'

describe('contentKey', () => {
  it('keys d2 by raw bytes, null on parse error', () => {
    expect(contentKey('d2', 'a\nb\n')).toBe('a\nb\n')
    expect(contentKey('d2', 'a -> ')).toBeNull()
  })

  it('keys layout by canonical form — formatting-invariant', () => {
    const messy = '{ "gridSize":40, "nodes":{ "a":{"cy":2,"cx":2,"h":2,"w":4} }, "edges":{} }'
    const canonical = canonicalizeLayout({
      gridSize: 40,
      nodes: { a: { cx: 2, cy: 2, w: 4, h: 2 } },
      edges: {},
    })
    expect(contentKey('layout', messy)).toBe(canonical)
    expect(contentKey('layout', '{ bad json')).toBeNull()
  })
})

describe('isValid + layoutToText', () => {
  it('isValid mirrors contentKey', () => {
    expect(isValid('d2', 'a\n')).toBe(true)
    expect(isValid('d2', 'a -> ')).toBe(false)
  })

  it('layoutToText produces canonical bytes', () => {
    const layout = { gridSize: 40, nodes: { a: { cx: 1, cy: 1, w: 4, h: 2 } }, edges: {} }
    expect(layoutToText(layout)).toBe(canonicalizeLayout(layout))
    expect(layoutToText(layout).endsWith('\n')).toBe(true)
  })
})
