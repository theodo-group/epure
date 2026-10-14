// Store-driven rerouting keeps the face-cache semantics the store used to
// enforce by hand. The editor's reroute scheduler owns a FaceCache that drops
// its faces by itself on a wholesale layout replacement; this replays an
// editing session through the real store and checks every route it publishes
// (each quick route, then the settled full route) against an ORACLE: the same
// router fed a cache that is never tracked and is instead reset exactly where
// the store used to call `invalidateFaceCache()` — loadDocument, openDocument,
// applyRemote({ layout }) and setLayout. Where that oracle starts from an empty
// cache, the old code's quick route equalled a fresh, cache-less one, so the
// store's must too; settled full routes must always equal a fresh route.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { validateLayoutJson } from '@/file/layoutSchema'
import { FaceCache, route } from '@/layout/elk'
import { normalizeForRoute } from '@/layout/normalize'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'

import { flushBurst, useDiagramStore } from './diagramStore'

const st = () => useDiagramStore.getState()

const FIXTURE = resolve(process.cwd(), 'fixtures/system.epr.d2')
const SOURCE = readFileSync(FIXTURE, 'utf8')
const LAYOUT = validateLayoutJson(
  readFileSync(FIXTURE.replace(/\.epr\.d2$/, '.epr.layout.json'), 'utf8'),
).value!

// Every node reflected across a vertical axis: the same topology, but each
// learned face points the wrong way — the case invalidation exists for.
const mirrored = (layout: LayoutSidecar): LayoutSidecar => {
  const copy: LayoutSidecar = structuredClone(layout)
  for (const n of Object.values(copy.nodes)) n.cx = 30 - n.cx
  return copy
}

// Resolve with the next `routed` the store publishes.
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

let oracle = new FaceCache()

// What App does after every change: reparse, reroute (quick now, full once the
// burst settles). Checks both routes against the oracle and, where the oracle
// had nothing to reuse, against a cache-less route.
const settle = async (oracleWasEmpty: boolean) => {
  st().reparse()
  const parsed = st().parseResult
  if (!parsed.ok) throw new Error('fixture edit does not parse')
  const routeInput = normalizeForRoute(parsed.diagram, st().layout)

  await st().reroute()
  const quick = st().routed
  const oracleQuick = await route(parsed.diagram, routeInput, { quick: true, faceCache: oracle })
  expect(quick).toEqual(oracleQuick)
  if (oracleWasEmpty) {
    expect(quick).toEqual(await route(parsed.diagram, routeInput, { quick: true }))
  }

  const full = await nextRouted()
  expect(full).toEqual(await route(parsed.diagram, routeInput, { faceCache: oracle }))
  expect(full).toEqual(await route(parsed.diagram, routeInput))
  flushBurst() // the next action is its own undo step
  return { quick, full }
}

describe('store rerouting with the scheduler-owned face cache', () => {
  beforeAll(() => {
    flushBurst()
  })

  it('matches the explicit-invalidation behaviour across an editing session', async () => {
    // loadDocument — old code invalidated.
    oracle = new FaceCache()
    st().loadDocument(SOURCE, LAYOUT)
    await settle(true)

    // Drag a node: faces are reused (oracle not reset).
    const api = st().layout.nodes.api!
    st().moveNode('api', (api.cx + 2) * 40, (api.cy + 1) * 40)
    await settle(false)

    // Add an edge: a topology change, so the cache misses in both.
    st().setSource(`${st().source}\nauth -> postgres\n`)
    await settle(true)

    // Rename a label: same topology, faces reused.
    st().setSource(st().source.replace('API Service', 'Core API'))
    await settle(false)

    // Undo the rename (an earlier snapshot of the same chain): reused.
    useDiagramStore.temporal.getState().undo()
    await settle(false)

    // Undo the added edge: back to the original topology, whose faces were
    // overwritten by the added-edge route — a miss in both.
    useDiagramStore.temporal.getState().undo()
    await settle(true)

    // openDocument with the same topology, every node mirrored — old code
    // invalidated. Guard the test's teeth: reusing the stale faces WOULD give a
    // different quick route here.
    const stale = new FaceCache()
    const parsed = st().parseResult
    if (!parsed.ok) throw new Error('parse')
    await route(parsed.diagram, normalizeForRoute(parsed.diagram, st().layout), {
      faceCache: stale,
    })
    const swapped = mirrored(LAYOUT)
    const withStale = await route(parsed.diagram, normalizeForRoute(parsed.diagram, swapped), {
      quick: true,
      faceCache: stale,
    })
    oracle = new FaceCache()
    st().openDocument(SOURCE, swapped)
    const { quick } = await settle(true)
    expect(quick).not.toEqual(withStale)

    // Drag after the open: reused again.
    const web = st().layout.nodes.web!
    st().moveNodes({ web: { cx: web.cx - 1, cy: web.cy + 2 } })
    await settle(false)

    // Pin a side (an edge-map edit): reused.
    st().setSelectedEdgeIds(['api->postgres#0'])
    st().setEdgeStyle({ sourceSide: 'S' })
    await settle(false)

    // A remote layout write (bridge / CC) — old code invalidated.
    oracle = new FaceCache()
    st().applyRemote({ layout: structuredClone(LAYOUT) })
    await settle(true)

    // The layout-JSON editor — old code invalidated.
    oracle = new FaceCache()
    st().setLayout(JSON.parse(JSON.stringify(mirrored(LAYOUT))))
    await settle(true)
  }, 30_000)
})
