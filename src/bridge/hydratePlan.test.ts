// @vitest-environment node
// The hydrate policy as a pure function: no DOM, no timers, no socket.

import { describe, expect, it } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { emptyLayout } from '@/layout/defaults'
import type { LayoutSidecar } from '@/layout/types'

import {
  type Doc,
  type HeldChange,
  type HydrateAction,
  type SettleAction,
  clashInfo,
  planHydrate,
  planSettle,
  withDiskChange,
} from './hydratePlan'
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
      return action.clash.local === local &&
        isDisk(action.clash.disk) &&
        action.clash.origin === 'backup'
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
    expect(clashInfo({ local, disk, origin: 'backup', kinds: ['d2', 'layout'] })).toEqual({
      origin: 'backup',
      localSavedAt: 7,
      local: { nodes: 2, edges: 1 },
      disk: { nodes: 1, edges: 0 },
    })
  })
})

describe('planSettle policy', () => {
  // The user's session started from `base` (D2 at layout(2)); a disk change to
  // one kind was held while they were busy. Settle it against the store.
  const BASE_D2 = D2
  const BASE_LAYOUT = canonicalizeLayout(layout(2))
  const DISK_D2 = `${D2}disk\n`
  const TYPED_D2 = `${D2}typed\n`
  const d2Change = (content: string, base: string | null = BASE_D2): HeldChange => ({
    kind: 'd2',
    content,
    base,
  })
  const layoutChange = (cx: number, base: string | null = BASE_LAYOUT): HeldChange => ({
    kind: 'layout',
    content: canonicalizeLayout(layout(cx)),
    base,
  })
  const settle = (held: HeldChange[], local: Doc) => planSettle({ held, local, now: 5 })

  /** One action as a table cell. */
  const cells = (actions: SettleAction[]) =>
    actions.map((a) =>
      a.type === 'apply'
        ? `apply ${a.kind}`
        : a.type === 'raise-clash'
          ? `raise-clash ${a.clash.kinds.join('+')}`
          : a.type,
    )

  const rows: [string, HeldChange[], Doc, string[]][] = [
    ['untouched d2 (take-disk)', [d2Change(DISK_D2)], at(2), ['apply d2']],
    [
      'd2 typed to match disk (take-disk)',
      [d2Change(DISK_D2)],
      { ...at(2), source: DISK_D2 },
      ['apply d2'],
    ],
    [
      'disk d2 back at base (keep-local)',
      [d2Change(BASE_D2)],
      { ...at(2), source: TYPED_D2 },
      ['push-local'],
    ],
    [
      'both changed the d2 (clash)',
      [d2Change(DISK_D2)],
      { ...at(2), source: TYPED_D2 },
      ['raise-clash d2'],
    ],
    [
      'an invalid d2 buffer vs a disk change (clash)',
      [d2Change(DISK_D2)],
      { ...at(2), source: 'a -> ' },
      ['raise-clash d2'],
    ],
    [
      'never-synced d2 that differs (clash)',
      [d2Change(DISK_D2, null)],
      { ...at(2), source: TYPED_D2 },
      ['raise-clash d2'],
    ],
    ['d2 changed on disk, user only dragged', [d2Change(DISK_D2)], at(8), ['apply d2']],
    [
      'layout changed on disk, user only typed',
      [layoutChange(9)],
      { ...at(2), source: TYPED_D2 },
      ['apply layout'],
    ],
    ['both changed the layout (clash)', [layoutChange(9)], at(8), ['raise-clash layout']],
    [
      'd2 clashes, layout untouched',
      [d2Change(DISK_D2), layoutChange(9)],
      { ...at(2), source: TYPED_D2 },
      ['raise-clash d2', 'apply layout'],
    ],
    [
      'd2 untouched, layout back at base',
      [d2Change(DISK_D2), layoutChange(2)],
      at(8),
      ['apply d2', 'push-local'],
    ],
  ]

  it.each(rows)('%s', (_name, held, local, expected) => {
    expect(cells(settle(held, local))).toEqual(expected)
  })

  it('applies the canonical disk contents', () => {
    expect(settle([d2Change(DISK_D2), layoutChange(9)], at(2))).toEqual([
      { type: 'apply', kind: 'd2', content: DISK_D2 },
      { type: 'apply', kind: 'layout', content: canonicalizeLayout(layout(9)) },
    ])
  })

  it('summarizes a session clash with the other kind already applied on both sides', () => {
    const [raise] = settle([d2Change(DISK_D2), layoutChange(9)], { ...at(2), source: TYPED_D2 })
    expect(raise).toEqual({
      type: 'raise-clash',
      clash: {
        origin: 'session',
        kinds: ['d2'],
        local: { source: TYPED_D2, layout: layout(9), base: null, savedAt: 5 },
        disk: { source: DISK_D2, layout: layout(9) },
      },
    })
  })

  it("moves a clash's disk side on when disk changes again", () => {
    const [raise] = settle([d2Change(DISK_D2)], { ...at(2), source: TYPED_D2 })
    if (raise?.type !== 'raise-clash') throw new Error('expected a clash')
    const moved = withDiskChange(raise.clash, 'layout', canonicalizeLayout(layout(11)))
    expect(moved.kinds).toEqual(['d2', 'layout'])
    expect(moved.disk).toEqual({ source: DISK_D2, layout: layout(11) })
    expect(moved.local).toBe(raise.clash.local)
    expect(withDiskChange(moved, 'd2', D2).kinds).toEqual(['d2', 'layout'])
  })
})
