// @vitest-environment node
// The hydrate policy as a pure function: no DOM, no timers, no socket.

import { describe, expect, it } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { emptyLayout } from '@/layout/defaults'
import type { LayoutSidecar } from '@/layout/types'

import { type Doc, type HydrateAction, clashInfo, planHydrate } from './hydratePlan'
import { docKeyOf, type DocBackup } from './offlineBackup'
import type { FileFrame } from './protocol'

const D2 = 'a\nb\na -> b\n'
const layout = (cx: number): LayoutSidecar => ({
  gridSize: 40,
  nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
  edges: {},
})
const frames = (d2: string | null, layoutText: string | null): FileFrame[] => [
  { kind: 'd2', content: d2, valid: true },
  { kind: 'layout', content: layoutText, valid: true },
]

// Disk always holds layout(2); the backups below sit at every reconcile verdict.
const disk: Doc = { source: D2, layout: layout(2) }
const diskFrames = frames(D2, canonicalizeLayout(disk.layout))
const backup = (cx: number, base: Doc | null): DocBackup => ({
  source: D2,
  layout: layout(cx),
  base: base ? docKeyOf(base.source, base.layout) : null,
  savedAt: 42,
})
const at = (cx: number): Doc => ({ source: D2, layout: layout(cx) })

type Verdict = 'take-disk' | 'keep-local' | 'clash'
const backups: { name: string; backup: DocBackup | null; verdict: Verdict }[] = [
  { name: 'no backup', backup: null, verdict: 'take-disk' },
  { name: 'backup equals disk', backup: backup(2, at(5)), verdict: 'take-disk' },
  { name: 'backup unedited, disk moved on', backup: backup(5, at(5)), verdict: 'take-disk' },
  { name: 'backup edited, disk at base', backup: backup(8, disk), verdict: 'keep-local' },
  { name: 'both moved past base', backup: backup(8, at(5)), verdict: 'clash' },
  { name: 'backup never synced, differs', backup: backup(8, null), verdict: 'clash' },
]

// The policy table from hydratePlan.ts, as data. Busy only matters for a
// reconnect that takes disk; every other row lists both values to prove it.
const policy: [Verdict, reconnect: boolean, busy: boolean, actions: string[]][] = [
  ['take-disk', false, false, ['clear-clash', 'load disk']],
  ['take-disk', false, true, ['clear-clash', 'load disk']],
  ['take-disk', true, false, ['clear-clash', 'apply disk']],
  ['take-disk', true, true, ['clear-clash', 'defer d2+layout']],
  ['keep-local', false, false, ['clear-clash', 'load local']],
  ['keep-local', false, true, ['clear-clash', 'load local']],
  ['keep-local', true, false, ['clear-clash', 'push-local']],
  ['keep-local', true, true, ['clear-clash', 'push-local']],
  ['clash', false, false, ['raise-clash', 'load local']],
  ['clash', false, true, ['raise-clash', 'load local']],
  ['clash', true, false, ['raise-clash']],
  ['clash', true, true, ['raise-clash']],
]

const isDisk = (doc: Doc) =>
  doc.source === disk.source &&
  docKeyOf(doc.source, doc.layout) === docKeyOf(disk.source, disk.layout)

/** One action as a table cell, checking its payload is the side it claims. */
const cell = (action: HydrateAction, local: DocBackup | null): string => {
  switch (action.type) {
    case 'load':
    case 'apply':
      return `${action.type} ${action.doc === local ? 'local' : isDisk(action.doc) ? 'disk' : '?'}`
    case 'defer':
      return `defer ${action.files.map((f) => f.kind).join('+')}`
    case 'raise-clash':
      return action.clash.local === local && isDisk(action.clash.disk)
        ? 'raise-clash'
        : 'raise-clash ?'
    default:
      return action.type
  }
}

const matrix = backups.flatMap(({ name, backup, verdict }) =>
  policy
    .filter(([v]) => v === verdict)
    .map(([, reconnect, busy, actions]) => ({ name, backup, verdict, reconnect, busy, actions })),
)

describe('planHydrate policy', () => {
  it('covers every backup state against every first-load/reconnect × idle/busy cell', () => {
    expect(matrix).toHaveLength(backups.length * 4)
  })

  it.each(matrix)(
    '$name ($verdict), reconnect=$reconnect, busy=$busy → $actions',
    ({ backup, reconnect, busy, actions }) => {
      const plan = planHydrate({ files: diskFrames, reconnect, backup, busy })
      expect(plan.disk).toEqual(disk)
      expect(plan.actions.map((a) => cell(a, backup))).toEqual(actions)
    },
  )

  it('defers the canonical disk contents', () => {
    const plan = planHydrate({ files: diskFrames, reconnect: true, backup: null, busy: true })
    expect(plan.actions[1]).toEqual({
      type: 'defer',
      files: [
        { kind: 'd2', content: D2 },
        { kind: 'layout', content: canonicalizeLayout(disk.layout) },
      ],
    })
  })
})

describe('planHydrate frames', () => {
  const plan = (files: FileFrame[], reconnect = false, busy = false) =>
    planHydrate({ files, reconnect, backup: null, busy })

  it('reads an absent layout file as the default layout', () => {
    expect(plan(frames(D2, null)).disk).toEqual({ source: D2, layout: emptyLayout() })
  })

  it('reads an invalid layout file as the default layout', () => {
    expect(plan(frames(D2, '{ bad')).disk.layout).toEqual(emptyLayout())
  })

  it('reads missing frames as an empty source and the default layout', () => {
    expect(plan([]).disk).toEqual({ source: '', layout: emptyLayout() })
  })

  it('defers only the layout when the d2 frame has no content', () => {
    const actions = plan(frames(null, canonicalizeLayout(layout(2))), true, true).actions
    expect(actions).toEqual([
      { type: 'clear-clash' },
      { type: 'defer', files: [{ kind: 'layout', content: canonicalizeLayout(layout(2)) }] },
    ])
  })

  it('applies an empty source when the d2 frame has no content and the user is idle', () => {
    const actions = plan(frames(null, canonicalizeLayout(layout(2))), true, false).actions
    expect(actions).toEqual([
      { type: 'clear-clash' },
      { type: 'apply', doc: { source: '', layout: layout(2) } },
    ])
  })

  it('compares a canonicalized layout, so formatting alone is not a change', () => {
    const handFormatted = JSON.stringify(layout(2), null, 4)
    const actions = planHydrate({
      files: frames(D2, handFormatted),
      reconnect: true,
      backup: backup(2, null),
      busy: false,
    }).actions
    expect(actions[0]).toEqual({ type: 'clear-clash' })
  })
})

describe('clashInfo', () => {
  it('summarizes each side by node and edge count', () => {
    const local: DocBackup = {
      source: D2,
      layout: {
        gridSize: 40,
        nodes: { a: { cx: 1, cy: 1, w: 4, h: 2 }, b: { cx: 9, cy: 1, w: 4, h: 2 } },
        edges: { 'a -> b': {} },
      },
      base: null,
      savedAt: 7,
    }
    expect(clashInfo({ local, disk })).toEqual({
      localSavedAt: 7,
      local: { nodes: 2, edges: 1 },
      disk: { nodes: 1, edges: 0 },
    })
  })
})
