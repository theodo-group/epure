// What the editor does when the server sends the disk state (a `hydrate`), as
// a pure function: frames + context in, a list of actions out. `useBridge`
// gathers the inputs (backup from localStorage, the interaction guard) and runs
// the actions against the store and the client; the decision lives here.

import { validateLayoutJson } from '@/file/layoutSchema'
import { emptyLayout } from '@/layout/defaults'
import type { LayoutSidecar } from '@/layout/types'

import { docKeyOf, reconcile, type DocBackup } from './offlineBackup'
import type { FileFrame, FileKind } from './protocol'
import { layoutToText } from './sync'

/** A diagram as the store holds it. */
export interface Doc {
  source: string
  layout: LayoutSidecar
}

/** Both sides of a genuine conflict, held until the user picks one. */
export interface Clash {
  local: DocBackup
  disk: Doc
}

/** A genuine conflict: the browser backup and the disk file BOTH changed since
 *  they were last in sync, so the user must pick which to keep. */
export interface ClashInfo {
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
  /** Hold these contents until the user goes quiet, then apply them the way a
   *  deferred `fileChanged` is applied. */
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
   *  below don't bounce disk's own content back to disk. */
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
 *
 * take-disk and keep-local also start with clear-clash. No backup always
 * reconciles to take-disk.
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
    const raise: HydrateAction = { type: 'raise-clash', clash: { local: backup, disk } }
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

/** The prompt's summary of a clash: when local was saved, and each side's size. */
export const clashInfo = ({ local, disk }: Clash): ClashInfo => ({
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
