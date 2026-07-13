// mintNodeId hands the canvas "create node" gesture a stable machine id. It must
// dodge every id already in play — nodes, areas, AND edge endpoints (an edge can
// reference an id that was never declared as a node) — since a collision is a
// parse error. It gap-fills (lowest free index) so ids stay stable across churn.

import { describe, expect, it } from 'vitest'

import { parse } from '@/parser'
import type { Diagram } from '@/parser/ast'

import { mintNodeId } from './diagramStore'

const diagramOf = (source: string): Diagram => {
  const result = parse(source)
  if (!result.ok) throw new Error('fixture failed to parse')
  return result.diagram
}

describe('mintNodeId', () => {
  it('returns n1 for an empty diagram', () => {
    expect(mintNodeId(diagramOf(''))).toBe('n1')
  })

  it('skips ids already taken by nodes', () => {
    expect(mintNodeId(diagramOf('n1\nn2\n'))).toBe('n3')
  })

  it('gap-fills the lowest free index rather than count+1', () => {
    // n1 and n3 exist → the next id is n2, not n3 (which would collide).
    expect(mintNodeId(diagramOf('n1\nn3\n'))).toBe('n2')
  })

  it('avoids ids used by areas', () => {
    const src = 'n1\nn2: "Group" {\n  n1\n}\n'
    // Area is `n2`, node is `n1` → first free is n3.
    expect(mintNodeId(diagramOf(src))).toBe('n3')
  })

  it('avoids ids that only appear as edge endpoints', () => {
    // `n1` is never declared as a node, only referenced by the edge; minting it
    // would silently adopt that dangling edge, so it must be skipped.
    expect(mintNodeId(diagramOf('a\na -> n1\n'))).toBe('n2')
  })

  it('ignores unrelated named ids', () => {
    expect(mintNodeId(diagramOf('api\nweb\ndb\n'))).toBe('n1')
  })
})
