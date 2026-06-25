import { describe, expect, it } from 'vitest'

import type { RoutedDiagram } from '@/layout/types'

import { resolvePin } from './pins'
import { parseComments, serializeComments } from './serialize'
import type { EprComment } from './types'

const comment = (over: Partial<EprComment> = {}): EprComment => ({
  id: 'c1',
  body: 'fix this',
  status: 'open',
  createdAt: '2026-06-25T10:00:00.000Z',
  author: 'user',
  target: { ref: 'api', x: 5, y: 3 },
  ...over,
})

describe('comments serialize/parse', () => {
  it('round-trips through canonical form', () => {
    const list = [comment(), comment({ id: 'c2', target: { x: 1, y: 1 }, status: 'resolved' })]
    const text = serializeComments(list)
    expect(text.endsWith('\n')).toBe(true)
    const back = parseComments(text)
    expect(back).toHaveLength(2)
    expect(back[0]).toMatchObject({ id: 'c1', body: 'fix this', target: { ref: 'api' } })
    // free-floating comment omits ref
    expect(back.find((c) => c.id === 'c2')!.target.ref).toBeUndefined()
  })

  it('is a fixed point and order-independent (echo-safe)', () => {
    const a = serializeComments([comment({ id: 'b' }), comment({ id: 'a' })])
    const b = serializeComments([comment({ id: 'a' }), comment({ id: 'b' })])
    // createdAt ties broken by id → deterministic regardless of input order.
    expect(a).toBe(b)
    expect(serializeComments(parseComments(a))).toBe(a)
  })

  it('tolerates garbage and absent files as an empty list', () => {
    expect(parseComments(null)).toEqual([])
    expect(parseComments('not json')).toEqual([])
    expect(parseComments('{"version":1}')).toEqual([])
    expect(parseComments('{"comments":[{"no":"id"}]}')).toEqual([])
  })

  it('coerces an unknown status to open and keeps a stable shape', () => {
    const [c] = parseComments('{"comments":[{"id":"x","body":"hi","status":"weird","target":{"x":2,"y":2}}]}')
    expect(c).toMatchObject({ id: 'x', status: 'open', target: { x: 2, y: 2 } })
  })
})

const routed = (): RoutedDiagram => ({
  gridSize: 40,
  nodes: [{ id: 'api', x: 80, y: 40, w: 160, h: 80 } as RoutedDiagram['nodes'][number]],
  areas: [{ id: 'Backend', x: 40, y: 20, w: 300, h: 200 } as RoutedDiagram['areas'][number]],
  edges: [
    { id: 'api->db#0', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], labelAnchor: { x: 50, y: 0 } } as RoutedDiagram['edges'][number],
  ],
})

describe('resolvePin (orphan policy)', () => {
  it('anchors to a node by ref', () => {
    const p = resolvePin(comment({ target: { ref: 'api', x: 0, y: 0 } }), routed())
    expect(p).toMatchObject({ resolved: true })
    expect(p.px).toBe(80 + 160) // node right edge
  })

  it('anchors to an edge by key', () => {
    const p = resolvePin(comment({ target: { ref: 'api->db', x: 0, y: 0 } }), routed())
    expect(p).toMatchObject({ px: 50, py: 0, resolved: true })
  })

  it('falls back to stored grid coords when the ref is gone (target-missing)', () => {
    const p = resolvePin(comment({ target: { ref: 'ghost', x: 5, y: 2 } }), routed())
    expect(p).toMatchObject({ px: 5 * 40, py: 2 * 40, resolved: false })
  })

  it('treats a refless comment as resolved at its stored point', () => {
    const p = resolvePin(comment({ target: { x: 3, y: 3 } }), routed())
    expect(p).toMatchObject({ px: 120, py: 120, resolved: true })
  })
})
