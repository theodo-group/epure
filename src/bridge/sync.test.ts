import { describe, expect, it } from 'vitest'

import { contentKey, contentVerdict, isValid, layoutToText } from './sync'

describe('contentKey', () => {
  it('keys d2 by raw bytes, null on parse error', () => {
    expect(contentKey('d2', 'a\nb\n')).toBe('a\nb\n')
    expect(contentKey('d2', 'a -> ')).toBeNull()
  })

  it('keys layout by meaning — formatting and key order do not matter', () => {
    const messy =
      '{ "gridSize":40, "nodes":{ "b":{"h":2,"w":4,"cy":2,"cx":9}, "a":{"cy":2,"cx":2,"h":2,"w":4} }, "edges":{} }'
    const tidy = `{
  "gridSize": 40,
  "nodes": {
    "a": { "cx": 2, "cy": 2, "w": 4, "h": 2 },
    "b": { "cx": 9, "cy": 2, "w": 4, "h": 2 }
  },
  "edges": {}
}
`
    expect(contentKey('layout', messy)).toBe(contentKey('layout', tidy))
    // …but a real change is a different key.
    expect(contentKey('layout', tidy.replace('"cx": 9', '"cx": 10'))).not.toBe(
      contentKey('layout', tidy),
    )
    expect(contentKey('layout', '{ bad json')).toBeNull()
  })
})

describe('isValid', () => {
  it('accepts content the editor can open, rejects the rest, for each kind', () => {
    expect(isValid('d2', 'a\n')).toBe(true)
    expect(isValid('d2', 'a -> ')).toBe(false)
    expect(isValid('layout', '{ "gridSize": 40, "nodes": {}, "edges": {} }')).toBe(true)
    expect(isValid('layout', '{ bad json')).toBe(false)
    // Well-formed JSON that is not a layout is still refused.
    expect(isValid('layout', '{ "gridSize": "big", "nodes": {}, "edges": {} }')).toBe(false)
  })

  it('reports where an invalid file breaks, as line:column', () => {
    expect(contentVerdict('d2', 'a\nb -> \n').error).toMatch(/^2:\d+ /)
    expect(contentVerdict('layout', '{\n  "gridSize": \n').error).toMatch(/^\d+:\d+ /)
  })
})

describe('layoutToText', () => {
  const layout = {
    gridSize: 40,
    nodes: { b: { cx: 9, cy: 1, w: 4, h: 2 }, a: { cx: 1, cy: 1, w: 4, h: 2 } },
    edges: { 'a->b': { color: 'blue' as const } },
  }

  it('writes text the bridge reads back as the same layout, under its own echo key', () => {
    const text = layoutToText(layout)
    expect(isValid('layout', text)).toBe(true)
    // The server keys a write by its canonical form: what we send must already
    // be that form, or our own write would not be recognised as an echo.
    expect(contentKey('layout', text)).toBe(text)
    expect(JSON.parse(text)).toEqual(layout)
  })

  it('is stable byte for byte whatever the object key order, ending in a newline', () => {
    const reordered = {
      edges: layout.edges,
      nodes: { a: layout.nodes.a, b: layout.nodes.b },
      gridSize: 40,
    }
    expect(layoutToText(reordered)).toBe(layoutToText(layout))
    expect(layoutToText(layout).endsWith('}\n')).toBe(true)
  })
})
