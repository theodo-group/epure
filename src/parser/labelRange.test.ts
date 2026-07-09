import { describe, expect, it } from 'vitest'

import { parse } from './index'
import type { NodeDecl } from './ast'

const onlyNode = (src: string): NodeDecl => {
  const r = parse(src)
  if (!r.ok) throw new Error(`parse failed: ${JSON.stringify(r.errors)}`)
  const node = r.diagram.nodes[0]
  if (!node) throw new Error('no node parsed')
  return node
}

const slice = (src: string, range: { start: { offset: number }; end: { offset: number } }) =>
  src.slice(range.start.offset, range.end.offset)

describe('NodeDecl id/label source ranges', () => {
  it('spans a quoted label including its quotes', () => {
    const src = 'gw: "<b>Hi</b>"'
    const node = onlyNode(src)
    expect(node.labelRange).toBeDefined()
    expect(slice(src, node.labelRange!)).toBe('"<b>Hi</b>"')
    expect(slice(src, node.idRange)).toBe('gw')
  })

  it('spans an unquoted multi-word label', () => {
    const src = 'web: Web App'
    const node = onlyNode(src)
    expect(slice(src, node.labelRange!)).toBe('Web App')
  })

  it('spans a label even when a block follows', () => {
    const src = 'db: Store { shape: cylinder }'
    const node = onlyNode(src)
    expect(slice(src, node.labelRange!)).toBe('Store')
  })

  it('has no labelRange when the node declares no label; idRange marks the insert point', () => {
    const src = 'lone { shape: person }'
    const node = onlyNode(src)
    expect(node.labelRange).toBeUndefined()
    expect(slice(src, node.idRange)).toBe('lone')
    // Inserting `: "X"` at idRange.end yields a well-formed declaration.
    const at = node.idRange.end.offset
    expect(`${src.slice(0, at)}: "X"${src.slice(at)}`).toBe(
      'lone: "X" { shape: person }',
    )
  })

  it('has no labelRange for a bare node', () => {
    const node = onlyNode('bare')
    expect(node.labelRange).toBeUndefined()
    expect(node.idRange.end.offset).toBe(4)
  })
})
