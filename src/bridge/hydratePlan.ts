// What the editor does when the server sends the disk state (a `hydrate`), and
// when a disk change it held back while the user was busy settles, as pure
// functions: frames + context in, a list of actions out. `useBridge` gathers the
// inputs (backup from localStorage, the interaction guard, the store) and runs
// the actions against the store and the client; the decisions live here.

import { validateLayoutJson } from '@/file/layoutSchema'
import { emptyLayout } from '@/layout/defaults'
import type { LayoutSidecar } from '@/layout/types'

import { docKeyOf, reconcile, type DocBackup } from './offlineBackup'
import type { FileFrame, FileKind } from './protocol'
import { contentKey, layoutToText } from './sync'

/** A diagram as the store holds it. */
export interface Doc {
  source: string
  layout: LayoutSidecar
}

/** Where a clash arose:
 *  - `backup`  on a (re)connect, the browser backup vs the disk file; choosing
 *              loads that side as the document,
 *  - `session` in the open session, a disk change held back while the user
 *              edited the same file; choosing keeps the session (and its undo
 *              history), and "disk" swaps in only the clashing kinds. */
export type ClashOrigin = 'backup' | 'session'

/** Both sides of a genuine conflict, held until the user picks one. Nothing is
 *  written to disk, and the browser backup isn't rewritten, until then. */
export interface Clash {
  local: DocBackup
  disk: Doc
  origin: ClashOrigin
  /** The kinds whose disk side differs from local. */
  kinds: FileKind[]
}

/** A genuine conflict: the local copy and the disk file BOTH changed since
 *  they were last in sync, so the user must pick which to keep. */
export interface ClashInfo {
  origin: ClashOrigin
  /** When the local copy was last saved in the browser (epoch ms). */
  localSavedAt: number
  local: { nodes: number; edges: number }
  disk: { nodes: number; edges: number }
}

export type HydrateAction =
  /** Prompt the user to choose between the two sides. */
  | { type: 'raise-clash'; clash: Clash }
  /** Dismiss a prompt left open by an earlier hydrate. */
  | { type: 'clear-clash' }
  /** Replace the document: a fresh baseline that clears undo history. */
  | { type: 'load'; doc: Doc }
  /** Write disk into the open session without touching undo, with a flash. */
  | { type: 'apply'; doc: Doc }
  /** Hold these contents until the user goes quiet, then settle them the way
   *  a deferred `fileChanged` is settled (`planSettle`). */
  | { type: 'defer'; files: { kind: FileKind; content: string }[] }
  /** Send the store's current content to disk. The store isn't changing, so
   *  nothing else would send it. */
  | { type: 'push-local' }

export interface HydrateInput {
  /** The hydrate's frames. A missing or null d2 reads as ''; a missing, null or
   *  invalid layout reads as the default empty layout. */
  files: FileFrame[]
  /** False for the session's first hydrate, true for every one after a drop. */
  reconnect: boolean
  /** This document's browser backup, if any. */
  backup: DocBackup | null
  /** The user is mid-drag or mid-keystroke (see `interaction.isBusy`). */
  busy: boolean
}

export interface HydratePlan {
  /** The disk state the frames describe: the new echo baseline. The caller
   *  records it with the client BEFORE running any action, so the store writes
   *  below don't bounce disk's own content back to disk. A deferred kind is the
   *  exception: it stays keyed at what the store last synced, the base it
   *  settles against. */
  disk: Doc
  actions: HydrateAction[]
}

/**
 * Decide what a hydrate does. `reconcile` (offlineBackup) compares disk, the
 * browser backup ("local") and the disk state the backup last synced with:
 *
 *   reconcile  | first load (store: empty or     | reconnect (store: the live
 *              |   the offline local copy)       |   session, edits included)
 *   -----------+---------------------------------+-------------------------------
 *   take-disk  | load disk                       | idle: apply disk
 *              |                                 | busy: defer disk (the d2 only
 *              |                                 |   when its frame has content)
 *   keep-local | load the backup (the outbound   | push-local (edits made offline
 *              |   subscriber sends it to disk)  |   never reached the socket)
 *   clash      | raise-clash, then load backup   | raise-clash (store untouched)
 *              |   (shown only: nothing is sent  |
 *              |   until the user chooses)       |
 *
 * take-disk and keep-local also start with clear-clash. No backup always
 * reconciles to take-disk.
 *
 * While a clash is open nothing reaches disk and the backup is left as it was,
 * so closing the tab leaves the same choice for the next visit. "Use the disk
 * version" writes nothing; "Keep my version" sends the local copy.
 */
export const planHydrate = ({ files, reconnect, backup, busy }: HydrateInput): HydratePlan => {
  const d2Frame = files.find((f) => f.kind === 'd2')
  const layoutFrame = files.find((f) => f.kind === 'layout')
  const disk: Doc = {
    source: d2Frame?.content ?? '',
    layout: layoutFromFrame(layoutFrame?.content ?? null),
  }

  const localKey = backup ? docKeyOf(backup.source, backup.layout) : null
  const verdict = reconcile(docKeyOf(disk.source, disk.layout), localKey, backup?.base ?? null)

  if (verdict === 'clash' && backup) {
    const raise: HydrateAction = {
      type: 'raise-clash',
      clash: { local: backup, disk, origin: 'backup', kinds: ['d2', 'layout'] },
    }
    // On reconnect the store already holds the local edits — leave them.
    return { disk, actions: reconnect ? [raise] : [raise, { type: 'load', doc: backup }] }
  }

  const clear: HydrateAction = { type: 'clear-clash' }

  if (verdict === 'keep-local' && backup) {
    return {
      disk,
      actions: [clear, reconnect ? { type: 'push-local' } : { type: 'load', doc: backup }],
    }
  }

  // take-disk.
  if (!reconnect) return { disk, actions: [clear, { type: 'load', doc: disk }] }
  if (!busy) return { disk, actions: [clear, { type: 'apply', doc: disk }] }
  const deferred: { kind: FileKind; content: string }[] = []
  if (d2Frame?.content != null) deferred.push({ kind: 'd2', content: disk.source })
  deferred.push({ kind: 'layout', content: layoutToText(disk.layout) })
  return { disk, actions: [clear, { type: 'defer', files: deferred }] }
}

/** A disk change held back while the user was busy. */
export interface HeldChange {
  kind: FileKind
  /** The (valid) disk content; a later change to the same kind replaces it. */
  content: string
  /** The key this kind was in sync with (sent, or received and applied) when
   *  the FIRST held change arrived: what the user's edits started from. */
  base: string | null
}

export type SettleAction =
  /** Prompt the user. Comes first, so the applies after it run with the
   *  outbound path already held and can't send the clashing local edits. */
  | { type: 'raise-clash'; clash: Clash }
  /** Write this kind's disk content into the session (paused, with a flash). */
  | { type: 'apply'; kind: FileKind; content: string }
  /** Send the store: a kind's disk "change" came back to the base, so the
   *  edits held for it have nothing on disk to clash with. */
  | { type: 'push-local' }

export interface SettleInput {
  held: HeldChange[]
  /** The store now. */
  local: Doc
  /** Stamped on a clash's local side ("edited just now"). */
  now: number
}

/**
 * Settle the disk changes held back while the user was busy (a `fileChanged`,
 * or a reconnect's take-disk `defer`), once they go idle. Until then a held
 * kind is held both ways: disk's change isn't applied and none of the user's
 * edits to that kind are sent, so neither side silently overwrites the other
 * (edits to the other kind flow as usual). Then, per held kind, `reconcile`
 * compares disk, the store ("local") and the base the kind was synced with
 * when the change arrived:
 *
 *   reconcile  | settle (user idle)
 *   -----------+---------------------------------------------------------------
 *   take-disk  | apply disk (no edits to this kind since the base, or they
 *              |   already match disk)
 *   keep-local | push-local (disk is back at the base: nothing new to keep)
 *   clash      | raise-clash, origin 'session' (the user's edits since the
 *              |   base and disk's change touched the same kind: the same
 *              |   prompt as on reconnect, both sides summarized)
 *
 * The take-disk kinds are applied even when another kind clashes; the prompt
 * covers only the clashing kinds. So the session always ends with the editor
 * matching disk, or with the prompt open and nothing of the clash written.
 */
export const planSettle = ({ held, local, now }: SettleInput): SettleAction[] => {
  const applies: SettleAction[] = []
  const clashing: HeldChange[] = []
  let push = false
  let shown = local
  for (const change of held) {
    const verdict = reconcile(
      identity(change.kind, change.content),
      identity(change.kind, textOf(local, change.kind)),
      change.base,
    )
    if (verdict === 'take-disk') {
      applies.push({ type: 'apply', kind: change.kind, content: change.content })
      shown = withKind(shown, change.kind, change.content)
    } else if (verdict === 'keep-local') push = true
    else clashing.push(change)
  }
  if (clashing.length === 0) return push ? [...applies, { type: 'push-local' }] : applies
  const clash: Clash = {
    local: { ...shown, base: null, savedAt: now },
    disk: clashing.reduce((doc, c) => withKind(doc, c.kind, c.content), shown),
    origin: 'session',
    kinds: clashing.map((c) => c.kind),
  }
  return [{ type: 'raise-clash', clash }, ...applies]
}

/** A clash whose disk side moved on while the prompt was open. */
export const withDiskChange = (clash: Clash, kind: FileKind, content: string): Clash => ({
  ...clash,
  disk: withKind(clash.disk, kind, content),
  kinds: clash.kinds.includes(kind) ? clash.kinds : [...clash.kinds, kind],
})

/** One kind of a doc as the text written to disk. */
export const textOf = (doc: Doc, kind: FileKind): string =>
  kind === 'd2' ? doc.source : layoutToText(doc.layout)

const withKind = (doc: Doc, kind: FileKind, content: string): Doc =>
  kind === 'd2' ? { ...doc, source: content } : { ...doc, layout: layoutFromFrame(content) }

/** Content identity as the client keys it. An invalid buffer has no key, so
 *  it's identified by its text: it still counts as an edit. */
const identity = (kind: FileKind, content: string): string => contentKey(kind, content) ?? content

/** The prompt's summary of a clash: when local was saved, and each side's size. */
export const clashInfo = ({ local, disk, origin }: Clash): ClashInfo => ({
  origin,
  localSavedAt: local.savedAt,
  local: sizeOf(local.layout),
  disk: sizeOf(disk.layout),
})

const sizeOf = (layout: LayoutSidecar) => ({
  nodes: Object.keys(layout.nodes).length,
  edges: Object.keys(layout.edges).length,
})

const layoutFromFrame = (content: string | null): LayoutSidecar => {
  if (content === null) return emptyLayout()
  return validateLayoutJson(content).value ?? emptyLayout()
}
