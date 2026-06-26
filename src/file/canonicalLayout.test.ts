import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { canonicalizeLayout } from './canonicalLayout'
import { validateLayoutJson } from './layoutSchema'

const parse = (text: string): LayoutSidecar => {
  const r = validateLayoutJson(text)
  if (!r.value) throw new Error(`invalid layout: ${r.errors[0]?.message}`)
  return r.value
}

describe('canonicalizeLayout', () => {
  it('emits a fixed key order, omits absent optionals, ends in a newline', () => {
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: { a: { cy: 2, cx: 1, h: 2, w: 4, borderColor: 'blue' } },
      edges: {},
    }
    const out = canonicalizeLayout(layout)
    expect(out.endsWith('\n')).toBe(true)
    // Geometry before style, regardless of input key order.
    expect(out).toContain('"a": { "cx": 1, "cy": 2, "w": 4, "h": 2, "borderColor": "blue" }')
    // No `areas` line when empty; no `null` anywhere.
    expect(out).not.toContain('areas')
    expect(out).not.toContain('null')
  })

  it('is a fixed point: canonical(parse(canonical(x))) === canonical(x)', () => {
    const variants: LayoutSidecar[] = [
      { gridSize: 40, nodes: {}, edges: {} },
      {
        gridSize: 20,
        nodes: {
          // Insertion order deliberately not sorted.
          zeta: { cx: 9, cy: 1, w: 4, h: 2 },
          alpha: { cx: 1, cy: 1, w: 4, h: 2, fillColor: 'teal', shape: 'cylinder' },
        },
        edges: { 'alpha->zeta': { color: 'red', lineStyle: 'dashed' } },
        areas: { cluster: { borderColor: 'gray' } },
      },
    ]
    for (const x of variants) {
      const once = canonicalizeLayout(x)
      const twice = canonicalizeLayout(parse(once))
      expect(twice).toBe(once)
    }
  })

  it('round-trips a negative label offset on an edge after its style fields', () => {
    const layout: LayoutSidecar = {
      gridSize: 40,
      nodes: {},
      edges: { 'a->b': { color: 'teal', labelDy: -2, labelDx: 3 } },
    }
    const out = canonicalizeLayout(layout)
    // Style first, then label offsets in (dx, dy) order.
    expect(out).toContain('"a->b": { "color": "teal", "labelDx": 3, "labelDy": -2 }')
    // Fixed point survives the new fields.
    expect(canonicalizeLayout(parse(out))).toBe(out)
  })

  it('sorts record ids deterministically, including numeric-looking ids', () => {
    const a = canonicalizeLayout({
      gridSize: 10,
      nodes: { '10': { cx: 0, cy: 0, w: 1, h: 1 }, '2': { cx: 1, cy: 1, w: 1, h: 1 } },
      edges: {},
    })
    const b = canonicalizeLayout({
      gridSize: 10,
      nodes: { '2': { cx: 1, cy: 1, w: 1, h: 1 }, '10': { cx: 0, cy: 0, w: 1, h: 1 } },
      edges: {},
    })
    expect(a).toBe(b)
    // Lexicographic: "10" before "2".
    expect(a.indexOf('"10"')).toBeLessThan(a.indexOf('"2"'))
  })

  it('round-trips the bundled fixture through parse without semantic loss', () => {
    const fixture = readFileSync(
      resolve(process.cwd(), 'fixtures/system.epr.layout.json'),
      'utf8',
    )
    const canonical = canonicalizeLayout(parse(fixture))
    // Re-parsing the canonical form yields the same canonical bytes.
    expect(canonicalizeLayout(parse(canonical))).toBe(canonical)
  })
})
