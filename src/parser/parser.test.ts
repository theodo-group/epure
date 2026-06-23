import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parse } from './index'

// Vitest sets cwd to the project root; resolve the fixture from there to
// sidestep the `about:blank` import.meta.url under jsdom.
const fixturePath = resolve(process.cwd(), 'fixtures/system.arch.d2')

function expectOk(source: string) {
  const result = parse(source)
  if (!result.ok) {
    throw new Error(
      `parse failed:\n${result.errors
        .map((e) => `  - ${e.message} @ ${JSON.stringify(e.range.start)}`)
        .join('\n')}\nsource:\n${source}`,
    )
  }
  return result.diagram
}

describe('parser — nodes', () => {
  it('parses a single bare node with default rectangle shape', () => {
    const d = expectOk('api')
    expect(d.nodes).toHaveLength(1)
    expect(d.nodes[0]).toMatchObject({
      kind: 'node',
      id: 'api',
      shape: 'rectangle',
      label: undefined,
    })
  })

  it('parses a quoted label', () => {
    const d = expectOk('api: "API Gateway"')
    expect(d.nodes[0]!.label).toBe('API Gateway')
  })

  it('parses unquoted multi-word labels', () => {
    const d = expectOk('queue: Job Queue')
    expect(d.nodes[0]!.label).toBe('Job Queue')
  })

  it('parses all 7 shapes', () => {
    const shapes = [
      'rectangle',
      'cylinder',
      'cloud',
      'person',
      'queue',
      'document',
      'page',
    ] as const
    const src = shapes
      .map((s, i) => `n${i}: "${s}" { shape: ${s} }`)
      .join('\n')
    const d = expectOk(src)
    expect(d.nodes.map((n) => n.shape)).toEqual(shapes)
  })
})

describe('parser — edges', () => {
  it('parses forward edges', () => {
    const d = expectOk('a\nb\na -> b')
    expect(d.edges).toHaveLength(1)
    expect(d.edges[0]).toMatchObject({
      source: 'a',
      target: 'b',
      direction: 'forward',
      style: 'solid',
    })
  })

  it('parses backward edges', () => {
    const d = expectOk('a <- b')
    expect(d.edges[0]!.direction).toBe('backward')
  })

  it('parses bidirectional edges', () => {
    const d = expectOk('a <-> b')
    expect(d.edges[0]!.direction).toBe('bidirectional')
  })

  it('parses edges with no direction', () => {
    const d = expectOk('a -- b')
    expect(d.edges[0]!.direction).toBe('none')
  })

  it('parses edge labels (quoted)', () => {
    const d = expectOk('a -> b: "writes"')
    expect(d.edges[0]!.label).toBe('writes')
  })

  it('maps stroke-dash 1..3 to dotted and >3 to dashed', () => {
    const dotted = expectOk('a -> b { style.stroke-dash: 2 }')
    expect(dotted.edges[0]!.style).toBe('dotted')
    const dashed = expectOk('a -> b { style.stroke-dash: 5 }')
    expect(dashed.edges[0]!.style).toBe('dashed')
    const solid = expectOk('a -> b { style.stroke-dash: 0 }')
    expect(solid.edges[0]!.style).toBe('solid')
  })
})

describe('parser — areas', () => {
  it('parses an area with two members', () => {
    const d = expectOk(
      ['a', 'b', 'group: "Group" {', '  a', '  b', '}'].join('\n'),
    )
    expect(d.areas).toHaveLength(1)
    expect(d.areas[0]).toMatchObject({
      kind: 'area',
      id: 'group',
      label: 'Group',
      members: ['a', 'b'],
    })
  })

  it('does not put non-area nodes into any area', () => {
    const d = expectOk(
      ['a', 'b', 'lone: "Lone" { shape: rectangle }'].join('\n'),
    )
    expect(d.areas).toHaveLength(0)
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'lone'])
  })

  it('supports semicolon-separated members on one line', () => {
    const d = expectOk('group: G { a; b; c }')
    expect(d.areas[0]!.members).toEqual(['a', 'b', 'c'])
  })
})

describe('parser — errors', () => {
  it('reports duplicate ids', () => {
    const r = parse('a\na')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => /Duplicate id/.test(e.message))).toBe(true)
  })

  it('reports unknown shapes', () => {
    const r = parse('a { shape: triangle }')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => /Unknown shape/.test(e.message))).toBe(true)
  })

  it('reports nested containers as a syntax error', () => {
    // A member followed by `{` would have to be a nested container, which the
    // grammar forbids: members are bare identifiers only.
    const r = parse('group: G {\n  inner: I {\n    a\n  }\n}')
    expect(r.ok).toBe(false)
  })

  it('rejects dotted attribute paths longer than 2', () => {
    const r = parse('a -> b { style.stroke.foo: 1 }')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => /Unsupported dotted attribute/.test(e.message)),
    ).toBe(true)
  })
})

describe('parser — fixture smoke test', () => {
  it('parses fixtures/system.arch.d2 cleanly', () => {
    const src = readFileSync(fixturePath, 'utf8')
    const r = parse(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.nodes).toHaveLength(5)
    expect(r.diagram.edges).toHaveLength(5)
    expect(r.diagram.areas).toHaveLength(2)
  })
})
