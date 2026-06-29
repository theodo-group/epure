import type { LayoutSidecar } from '@/layout/types'

const KEY = 'epure:doc:v1'

export interface StoredDoc {
  source: string
  layout: LayoutSidecar
  /** Filename stem of the document (e.g. `system`), for the UI + export name.
   *  Optional: undo/redo history snapshots reuse this shape and omit it. */
  name?: string
}

const isLayoutSidecar = (value: unknown): value is LayoutSidecar => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.gridSize === 'number' &&
    typeof v.nodes === 'object' &&
    typeof v.edges === 'object'
  )
}

export const loadStoredDoc = (): StoredDoc | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.source !== 'string') return null
    if (!isLayoutSidecar(obj.layout)) return null
    return {
      source: obj.source,
      layout: obj.layout,
      ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
    }
  } catch {
    return null
  }
}

export const saveStoredDoc = (doc: StoredDoc): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc))
  } catch {
    // Quota exceeded or storage disabled — silently drop; the file Open/Export
    // paths remain available as a manual backup.
  }
}

// ── Undo/redo history ──────────────────────────────────────────────────────
// The zundo temporal store keeps the undo (past) and redo (future) stacks in
// memory; persisting them lets undo/redo survive a page reload. Each entry is a
// tracked `{ source, layout }` snapshot — the same shape as StoredDoc.

const HISTORY_KEY = 'epure:history:v1'
// Cap the persisted depth so a long editing session can't blow the localStorage
// quota. Undo/redo operate on the END of each stack, so the most recent entries
// are the ones worth keeping.
const MAX_PERSISTED = 50

export interface StoredHistory {
  past: StoredDoc[]
  future: StoredDoc[]
}

const isStoredDoc = (value: unknown): value is StoredDoc => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.source === 'string' && isLayoutSidecar(v.layout)
}

export const loadStoredHistory = (): StoredHistory | null => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (!Array.isArray(obj.past) || !Array.isArray(obj.future)) return null
    return {
      past: obj.past.filter(isStoredDoc),
      future: obj.future.filter(isStoredDoc),
    }
  } catch {
    return null
  }
}

export const saveStoredHistory = (history: StoredHistory): void => {
  try {
    const trimmed: StoredHistory = {
      past: history.past.slice(-MAX_PERSISTED),
      future: history.future.slice(-MAX_PERSISTED),
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch {
    // Quota exceeded or storage disabled — drop silently.
  }
}

export const clearStoredHistory = (): void => {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}
