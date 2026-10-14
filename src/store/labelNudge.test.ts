// Dragging an edge label is a label-only layout edit: the store must move the
// label without routing again. Routing would visibly bounce the edge (the
// quick pass is areas-blind and skips port swaps) under the pointer.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateLayoutJson } from '@/file/layoutSchema'
import type { RoutedDiagram } from '@/layout/types'

import { useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

const FIXTURE = resolve(process.cwd(), 'fixtures/system.epr.d2')
const SOURCE = readFileSync(FIXTURE, 'utf8')
const LAYOUT = validateLayoutJson(
  readFileSync(FIXTURE.replace(/\.epr\.d2$/, '.epr.layout.json'), 'utf8'),
).value!

const nextRouted = () =>
  new Promise<RoutedDiagram>((done, fail) => {
    const timer = setTimeout(() => {
      unsub()
      fail(new Error('no route published'))
    }, 5000)
    const unsub = useDiagramStore.subscribe((s, prev) => {
      if (s.routed && s.routed !== prev.routed) {
        clearTimeout(timer)
        unsub()
        done(s.routed)
      }
    })
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('label nudge', () => {
  it('moves the label without routing the edge again', async () => {
    st().loadDocument(SOURCE, LAYOUT)
    st().reparse()
    void st().reroute()
    await nextRouted() // quick
    await sleep(400) // …and the settled full route
    const before = st().routed!
    const edge = before.edges.find((e) => e.id.startsWith('user->cdn'))!
    expect(edge.labelAnchor).toBeDefined()

    st().setEdgeLabelOffset(edge.id, 2, -1)
    await st().reroute()

    const after = st().routed!
    const moved = after.edges.find((e) => e.id === edge.id)!
    // Published synchronously, with the label offset applied in grid units…
    expect(moved.labelDx).toBe(2)
    expect(moved.labelDy).toBe(-1)
    expect(moved.labelAnchor!.x).toBeCloseTo(edge.labelAnchor!.x + 2 * before.gridSize)
    expect(moved.labelAnchor!.y).toBeCloseTo(edge.labelAnchor!.y - 1 * before.gridSize)
    // …and no route ran: every edge keeps the very same points array.
    for (const e of after.edges) {
      expect(e.points).toBe(before.edges.find((b) => b.id === e.id)!.points)
    }
    // Nor does one run later (no deferred full pass was scheduled).
    await sleep(400)
    expect(st().routed).toBe(after)
  })

  it('still routes when anything but a label offset changes', async () => {
    st().loadDocument(SOURCE, LAYOUT)
    st().reparse()
    void st().reroute()
    await nextRouted()
    await sleep(400)
    const before = st().routed!
    const user = st().layout.nodes.user!
    st().moveNode('user', (user.cx + 3) * before.gridSize, user.cy * before.gridSize)
    const routedPromise = nextRouted()
    void st().reroute()
    const after = await routedPromise
    expect(after).not.toBe(before)
    const u = after.nodes.find((n) => n.id === 'user')!
    expect(u.x).toBeCloseTo(before.nodes.find((n) => n.id === 'user')!.x + 3 * before.gridSize)
  })
})
