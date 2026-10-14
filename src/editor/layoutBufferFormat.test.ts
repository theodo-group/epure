// Format on the layout tab: the buffer shows the canonical text (the bytes the
// bridge writes). The store already holds that layout, so nothing is written.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import type { LayoutSidecar } from '@/layout/types'

import { useLayoutEditorBuffer } from './useLayoutEditorBuffer'

const layout: LayoutSidecar = {
  gridSize: 40,
  nodes: { b: { cx: 6, cy: 2, w: 4, h: 2 }, a: { cx: 2, cy: 2, w: 4, h: 2 } },
  edges: {},
}

const mount = () => {
  const setLayout = vi.fn()
  const view = renderHook(() => useLayoutEditorBuffer(layout, setLayout))
  return { setLayout, ...view }
}

describe('useLayoutEditorBuffer — format', () => {
  it('shows the store layout as its canonical text', () => {
    const { result } = mount()
    expect(result.current.text).toBe(canonicalizeLayout(layout))
  })

  it('rewrites a hand-edited buffer to the canonical text, without writing the store', () => {
    const { result, setLayout } = mount()
    const messy = JSON.stringify(layout)
    act(() => result.current.edit(messy))
    setLayout.mockClear()
    let changed = false
    act(() => {
      changed = result.current.format()
    })
    expect(changed).toBe(true)
    expect(result.current.text).toBe(canonicalizeLayout(layout))
    // The pane echoes the new value back through `edit`: not an edit.
    act(() => result.current.edit(canonicalizeLayout(layout)))
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('is a no-op on canonical text', () => {
    const { result } = mount()
    let changed = true
    act(() => {
      changed = result.current.format()
    })
    expect(changed).toBe(false)
  })

  it('leaves invalid JSON alone', () => {
    const { result } = mount()
    act(() => result.current.edit('{ "gridSize": '))
    let changed = true
    act(() => {
      changed = result.current.format()
    })
    expect(changed).toBe(false)
    expect(result.current.text).toBe('{ "gridSize": ')
  })
})
