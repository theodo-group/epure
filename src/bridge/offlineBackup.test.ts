import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { docKeyOf, readBackup, writeBackup, clearBackup, reconcile } from './offlineBackup'

// jsdom's localStorage is a no-op in this runner; back it with a real Map.
const installLocalStorage = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
}

const layout = (cx: number): LayoutSidecar => ({
  gridSize: 40,
  nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
  edges: {},
})

describe('offlineBackup reconcile', () => {
  it('takes disk when there is no local copy', () => {
    expect(reconcile('disk', null, null)).toBe('take-disk')
  })
  it('takes disk when local already equals disk', () => {
    expect(reconcile('x', 'x', 'base')).toBe('take-disk')
  })
  it('takes disk when local is unedited but disk advanced', () => {
    // local == base (no local edits), disk moved on → disk wins, no prompt.
    expect(reconcile('disk2', 'base', 'base')).toBe('take-disk')
  })
  it('keeps local when disk is unchanged but local was edited', () => {
    expect(reconcile('base', 'local2', 'base')).toBe('keep-local')
  })
  it('flags a clash when both diverged from base', () => {
    expect(reconcile('disk2', 'local2', 'base')).toBe('clash')
  })
  it('flags a clash when they differ and there is no base to vouch', () => {
    expect(reconcile('disk', 'local', null)).toBe('clash')
  })
})

describe('offlineBackup storage', () => {
  beforeEach(() => {
    installLocalStorage()
    clearBackup('doc')
  })

  it('round-trips a backup', () => {
    writeBackup('doc', { source: 'a\nb\n', layout: layout(2), base: 'k', savedAt: 5 })
    const got = readBackup('doc')
    expect(got?.source).toBe('a\nb\n')
    expect(got?.layout.nodes.a!.cx).toBe(2)
    expect(got?.base).toBe('k')
  })

  it('docKeyOf is stable for equal content and differs for changed layout', () => {
    expect(docKeyOf('s', layout(2))).toBe(docKeyOf('s', layout(2)))
    expect(docKeyOf('s', layout(2))).not.toBe(docKeyOf('s', layout(9)))
  })

  it('namespaces by doc id (one doc cannot read another)', () => {
    writeBackup('docA', { source: 'A', layout: layout(1), base: null, savedAt: 1 })
    writeBackup('docB', { source: 'B', layout: layout(2), base: null, savedAt: 1 })
    expect(readBackup('docA')?.source).toBe('A')
    expect(readBackup('docB')?.source).toBe('B')
    clearBackup('docA')
    clearBackup('docB')
  })
})
