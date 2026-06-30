// Per-document browser backup for bridge mode. The bridge treats DISK as the
// source of truth, but the WebSocket can be down (server stopped, network blip)
// — and the user must never be left staring at a blank canvas or silently lose
// edits made while offline. So we mirror the current doc to localStorage keyed
// by its bridge identity, and on (re)connect run a 3-way reconcile to decide
// whether to take disk, keep the local copy, or ask the user.
//
// Why 3-way (local vs disk vs base) rather than a plain "do they differ?": in
// this app the agent edits the file on disk too, so "differs" is common and
// benign. `base` — the disk state the local copy was last in sync with — lets us
// tell a real conflict (BOTH changed) from a stale-but-unedited local copy
// (only disk changed → just take disk) or unsynced local edits (only local
// changed → keep them). Only a real conflict prompts.

import { canonicalizeLayout } from '@/file/canonicalLayout'
import type { LayoutSidecar } from '@/layout/types'

const PREFIX = 'epure:backup:v1:'
const keyFor = (docId: string) => `${PREFIX}${docId}`

export interface DocBackup {
  source: string
  layout: LayoutSidecar
  /** Canonical key of the disk state this copy was last reconciled with, or null
   *  if it has never been synced (then any divergence is treated as a conflict —
   *  the safe default, since we can't prove the local edits are already on disk). */
  base: string | null
  /** Wall-clock of the last write, for the conflict prompt's "Local (just now)". */
  savedAt: number
}

/** Stable identity of a (source, layout) pair: raw d2 + canonical layout. Matches
 *  the bridge's own content keys, so equality here means equality on disk. */
export const docKeyOf = (source: string, layout: LayoutSidecar): string =>
  `${source}\u0000${canonicalizeLayout(layout)}`

const isLayout = (v: unknown): v is LayoutSidecar => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.gridSize === 'number' &&
    typeof o.nodes === 'object' &&
    o.nodes !== null &&
    typeof o.edges === 'object' &&
    o.edges !== null
  )
}

export const readBackup = (docId: string): DocBackup | null => {
  try {
    const raw = localStorage.getItem(keyFor(docId))
    if (!raw) return null
    const o = JSON.parse(raw) as Record<string, unknown>
    if (typeof o.source !== 'string' || !isLayout(o.layout)) return null
    return {
      source: o.source,
      layout: o.layout,
      base: typeof o.base === 'string' ? o.base : null,
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
    }
  } catch {
    return null
  }
}

export const writeBackup = (docId: string, backup: DocBackup): void => {
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(backup))
  } catch {
    // Quota exceeded or storage disabled — the disk file remains the durable copy.
  }
}

export const clearBackup = (docId: string): void => {
  try {
    localStorage.removeItem(keyFor(docId))
  } catch {
    // ignore
  }
}

export type ReconcileAction =
  /** Local matches disk, or has no edits beyond the synced base — disk wins. */
  | 'take-disk'
  /** Only the local copy changed (disk still at base) — restore + push it. */
  | 'keep-local'
  /** Local and disk both moved past the base — the user must choose. */
  | 'clash'

/** Decide what to do when a disk state arrives and a local backup exists. */
export const reconcile = (
  diskKey: string,
  localKey: string | null,
  base: string | null,
): ReconcileAction => {
  if (localKey === null) return 'take-disk' // no local copy at all
  if (localKey === diskKey) return 'take-disk' // already identical
  if (base !== null && localKey === base) return 'take-disk' // local unedited; disk advanced
  if (base !== null && diskKey === base) return 'keep-local' // disk unchanged; local has edits
  return 'clash' // both diverged from base (or no base to vouch for either)
}
