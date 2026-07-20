// Nested-area (container) helpers, shared by routing (elk.ts), the canvas
// drag path (App.tsx), and anything else that needs to reason about area
// membership as a hierarchy.
//
// Nesting is BY REFERENCE: an area's member list may name another area's id
// (the grammar still rejects a literal nested block). The parser's visitor
// rejects self-membership and membership cycles, so on a clean parse the
// member graph is a DAG — but every walk here still carries an in-stack guard
// so a cycle that slips through (e.g. a hand-built AST in tests) terminates
// instead of recursing forever.

import type { AreaDecl } from '@/parser/ast'

export interface AreaTree {
  byId: Map<string, AreaDecl>
  /** Nesting depth per area id: 0 for a root area (no parent lists it),
   *  1 + max(parent depths) otherwise. Drives paint order — parents first. */
  depthOf: Map<string, number>
  /** Transitive NODE members per area id: the member lists flattened through
   *  nested areas down to leaf node ids. Member ids that name neither a node
   *  nor an area pass through unchanged (they resolve to nothing downstream,
   *  exactly like a dangling member does today). */
  leafNodesOf: Map<string, Set<string>>
  /** Every area transitively containing the given area. */
  ancestorsOf: Map<string, Set<string>>
}

export const buildAreaTree = (areas: AreaDecl[]): AreaTree => {
  const byId = new Map(areas.map((a) => [a.id, a] as const))

  // Direct parents. An area listed by several parents is unioned into each,
  // mirroring how a node shared by two areas already behaves.
  const parentsOf = new Map<string, string[]>()
  for (const a of areas) {
    for (const mid of a.members) {
      if (!byId.has(mid) || mid === a.id) continue
      const arr = parentsOf.get(mid) ?? []
      arr.push(a.id)
      parentsOf.set(mid, arr)
    }
  }

  const depthOf = new Map<string, number>()
  const depth = (id: string, stack: Set<string>): number => {
    const hit = depthOf.get(id)
    if (hit !== undefined) return hit
    if (stack.has(id)) return 0
    stack.add(id)
    let d = 0
    for (const pid of parentsOf.get(id) ?? []) {
      d = Math.max(d, depth(pid, stack) + 1)
    }
    stack.delete(id)
    depthOf.set(id, d)
    return d
  }
  for (const a of areas) depth(a.id, new Set())

  const leafNodesOf = new Map<string, Set<string>>()
  const leaves = (id: string, stack: Set<string>): Set<string> => {
    const hit = leafNodesOf.get(id)
    if (hit) return hit
    const out = new Set<string>()
    if (stack.has(id)) return out
    stack.add(id)
    for (const mid of byId.get(id)?.members ?? []) {
      if (byId.has(mid)) {
        for (const n of leaves(mid, stack)) out.add(n)
      } else {
        out.add(mid)
      }
    }
    stack.delete(id)
    leafNodesOf.set(id, out)
    return out
  }
  for (const a of areas) leaves(a.id, new Set())

  const ancestorsOf = new Map<string, Set<string>>()
  const ancestors = (id: string, stack: Set<string>): Set<string> => {
    const hit = ancestorsOf.get(id)
    if (hit) return hit
    const out = new Set<string>()
    if (stack.has(id)) return out
    stack.add(id)
    for (const pid of parentsOf.get(id) ?? []) {
      out.add(pid)
      for (const anc of ancestors(pid, stack)) out.add(anc)
    }
    stack.delete(id)
    ancestorsOf.set(id, out)
    return out
  }
  for (const a of areas) ancestors(a.id, new Set())

  return { byId, depthOf, leafNodesOf, ancestorsOf }
}
