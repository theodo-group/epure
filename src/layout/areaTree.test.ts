import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'

import { buildAreaTree } from './areaTree'

const areasOf = (src: string) => {
  const r = parse(src)
  if (!r.ok) throw new Error(`parse failed: ${r.errors[0]?.message}`)
  return r.diagram.areas
}

describe('buildAreaTree', () => {
  it('flattens transitive node members through nested areas', () => {
    const tree = buildAreaTree(
      areasOf(
        'a\nb\nc\nd\n' +
          'Inner { a\n b }\n' +
          'Mid { Inner\n c }\n' +
          'Outer { Mid\n d }\n',
      ),
    )
    expect([...tree.leafNodesOf.get('Inner')!].sort()).toEqual(['a', 'b'])
    expect([...tree.leafNodesOf.get('Mid')!].sort()).toEqual(['a', 'b', 'c'])
    expect([...tree.leafNodesOf.get('Outer')!].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('computes depths (roots at 0) and ancestor sets', () => {
    const tree = buildAreaTree(
      areasOf('a\nb\nInner { a }\nMid { Inner }\nOuter { Mid\n b }\n'),
    )
    expect(tree.depthOf.get('Outer')).toBe(0)
    expect(tree.depthOf.get('Mid')).toBe(1)
    expect(tree.depthOf.get('Inner')).toBe(2)
    expect([...tree.ancestorsOf.get('Inner')!].sort()).toEqual(['Mid', 'Outer'])
    expect([...tree.ancestorsOf.get('Outer')!]).toEqual([])
  })

  it('passes dangling member ids through as leaf nodes', () => {
    // `ghost` names neither a node nor an area — it flows through unchanged and
    // resolves to nothing downstream (same as a dangling member today).
    const tree = buildAreaTree(areasOf('a\nBox { a\n ghost }\n'))
    expect([...tree.leafNodesOf.get('Box')!].sort()).toEqual(['a', 'ghost'])
  })

  it('terminates on a membership cycle (defensive — parser rejects these)', () => {
    // Hand-built AST: A ∈ B and B ∈ A. The tree must not recurse forever.
    const cyclic = [
      { kind: 'area', id: 'A', members: ['B'], memberRanges: [], range: r() },
      { kind: 'area', id: 'B', members: ['A'], memberRanges: [], range: r() },
    ] as const
    const tree = buildAreaTree([...cyclic] as never)
    expect(tree.leafNodesOf.get('A')!.size).toBe(0)
    expect(tree.depthOf.get('A')).toBeGreaterThanOrEqual(0)
  })
})

const r = () => ({
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
})
