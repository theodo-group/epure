import type { LayoutSidecar } from '@/layout/types'

const KEY = 'archgrid:doc:v1'

export interface StoredDoc {
  source: string
  layout: LayoutSidecar
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
    return { source: obj.source, layout: obj.layout }
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
