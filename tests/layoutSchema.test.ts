import { describe, it, expect } from 'vitest'
import { locateLayoutKeyRanges, validateLayoutJson } from '@/file/layoutSchema'

const ok = (text: string) => {
  const r = validateLayoutJson(text)
  if (r.errors.length) {
    throw new Error('expected no errors, got: ' + JSON.stringify(r.errors))
  }
  return r.value!
}

describe('validateLayoutJson', () => {
  it('parses a minimal valid layout', () => {
    const v = ok('{"gridSize":40,"nodes":{},"edges":{}}')
    expect(v.gridSize).toBe(40)
  })

  it('reports JSON syntax errors with position', () => {
    const r = validateLayoutJson('{"gridSize": 40,}')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.message).toMatch(/Expected string key/)
    expect(r.errors[0]!.range.start.offset).toBe(16)
  })

  it('rejects unknown root fields and points at the key', () => {
    const text = `{
  "gridSize": 40,
  "nodes": {},
  "edges": {},
  "bogus": 1
}`
    const r = validateLayoutJson(text)
    expect(r.errors.some((e) => /Unknown root field "bogus"/.test(e.message))).toBe(true)
    const bogus = r.errors.find((e) => e.message.includes('bogus'))!
    expect(bogus.range.start.line).toBe(5)
  })

  it('flags unknown palette colors on a node', () => {
    const text = `{
  "gridSize": 40,
  "nodes": { "a": { "cx": 1, "cy": 1, "w": 2, "h": 2, "borderColor": "indigo" } },
  "edges": {}
}`
    const r = validateLayoutJson(text)
    expect(r.value).toBeNull()
    const e = r.errors.find((x) => x.message.includes('borderColor'))!
    expect(e.message).toMatch(/must be one of/)
    expect(e.range.start.line).toBe(3)
  })

  it('flags missing required node fields', () => {
    const text = '{"gridSize":40,"nodes":{"a":{"cx":1,"cy":1}},"edges":{}}'
    const r = validateLayoutJson(text)
    expect(r.errors.map((e) => e.message).sort()).toEqual([
      'Node "a" is missing "h"',
      'Node "a" is missing "w"',
    ])
  })

  it('flags unknown edge fields', () => {
    const text = `{
  "gridSize": 40,
  "nodes": {},
  "edges": { "a->b": { "thickness": "M" } }
}`
    const r = validateLayoutJson(text)
    expect(r.errors[0]!.message).toMatch(/Unknown edge field "thickness"/)
  })

  it('accepts integer label offsets on an edge, including negatives', () => {
    const v = ok('{"gridSize":40,"nodes":{},"edges":{"a->b":{"labelDx":-3,"labelDy":2}}}')
    expect(v.edges['a->b']).toMatchObject({ labelDx: -3, labelDy: 2 })
  })

  it('rejects a non-integer label offset', () => {
    const r = validateLayoutJson('{"gridSize":40,"nodes":{},"edges":{"a->b":{"labelDx":1.5}}}')
    expect(r.errors.some((e) => /labelDx must be an integer/.test(e.message))).toBe(true)
  })

  it('flags wrong types', () => {
    const text = `{"gridSize":"forty","nodes":{},"edges":{}}`
    const r = validateLayoutJson(text)
    expect(r.errors[0]!.message).toMatch(/gridSize must be a number/)
  })

  it('accepts the bundled fixture', async () => {
    const fixture = await import('../fixtures/system.epr.layout.json?raw')
    const r = validateLayoutJson(fixture.default)
    expect(r.errors).toEqual([])
    expect(r.value).not.toBeNull()
  })

  it('rejects unknown icon ids', () => {
    const text = `{
  "gridSize": 40,
  "nodes": { "a": { "cx": 1, "cy": 1, "w": 2, "h": 2, "icon": "not/a/real/icon" } },
  "edges": {}
}`
    const r = validateLayoutJson(text)
    expect(r.errors.some((e) => /Unknown icon/.test(e.message))).toBe(true)
  })
})

describe('locateLayoutKeyRanges', () => {
  const text = JSON.stringify(
    {
      gridSize: 40,
      nodes: {
        a: { cx: 1, cy: 1, w: 2, h: 2 },
        b: { cx: 5, cy: 5, w: 2, h: 2 },
      },
      edges: { 'a->b': { color: 'blue' } },
      areas: { Services: { fillColor: 'purple' } },
    },
    null,
    2,
  )
  // Pull the substring a range points at, so assertions read off real content.
  const slice = (r: { from: number; to: number }) => text.slice(r.from, r.to)

  it('spans a node entry from its key quote to the end of its value', () => {
    const [r] = locateLayoutKeyRanges(text, { nodes: ['a'] })
    expect(r).toBeDefined()
    expect(slice(r!)).toBe('"a": {\n      "cx": 1,\n      "cy": 1,\n      "w": 2,\n      "h": 2\n    }')
  })

  it('locates edges and areas by their map keys', () => {
    const edge = locateLayoutKeyRanges(text, { edges: ['a->b'] })
    expect(edge).toHaveLength(1)
    expect(slice(edge[0]!)).toBe('"a->b": {\n      "color": "blue"\n    }')

    const area = locateLayoutKeyRanges(text, { areas: ['Services'] })
    expect(area).toHaveLength(1)
    expect(slice(area[0]!).startsWith('"Services"')).toBe(true)
  })

  it('returns a range per requested key across sections', () => {
    const ranges = locateLayoutKeyRanges(text, {
      nodes: ['a', 'b'],
      edges: ['a->b'],
    })
    expect(ranges).toHaveLength(3)
  })

  it('skips absent keys, absent sections, and duplicate requests', () => {
    expect(locateLayoutKeyRanges(text, { nodes: ['missing'] })).toEqual([])
    // No `areas` section present → nothing, no throw.
    const noAreas = '{"gridSize":40,"nodes":{},"edges":{}}'
    expect(locateLayoutKeyRanges(noAreas, { areas: ['x'] })).toEqual([])
    // Duplicate ids collapse to one range (one entry in the JSON).
    expect(locateLayoutKeyRanges(text, { nodes: ['a', 'a'] })).toHaveLength(1)
  })

  it('returns [] on unparseable text instead of throwing', () => {
    expect(locateLayoutKeyRanges('{ not valid json', { nodes: ['a'] })).toEqual([])
  })
})
