// The layout JSON editor buffer is a second representation of `store.layout`.
// These cover the load-bearing invariant: valid edits flow to the store, but a
// store-side change (a node drag, a remote write) must never silently discard an
// in-progress *invalid* edit — the bug where moving a node wiped your JSON edit.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LayoutSidecar } from '@/layout/types'

import { useLayoutEditorBuffer } from './useLayoutEditorBuffer'

const layoutWith = (cx: number): LayoutSidecar => ({
  gridSize: 40,
  nodes: { a: { cx, cy: 2, w: 4, h: 2 } },
  edges: {},
})

const mount = (initial: LayoutSidecar) => {
  const setLayout = vi.fn()
  const view = renderHook(
    ({ layout }) => useLayoutEditorBuffer(layout, setLayout),
    { initialProps: { layout: initial } },
  )
  return { setLayout, ...view }
}

describe('useLayoutEditorBuffer', () => {
  it('pushes a valid edit to the store', () => {
    const { result, setLayout } = mount(layoutWith(2))
    const next = JSON.stringify(layoutWith(5), null, 2)
    act(() => result.current.edit(next))
    expect(setLayout).toHaveBeenCalledTimes(1)
    expect(setLayout.mock.calls[0]![0]).toEqual(layoutWith(5))
    expect(result.current.text).toBe(next)
    expect(result.current.errors).toEqual([])
  })

  it('keeps an invalid edit out of the store but surfaces errors', () => {
    const { result, setLayout } = mount(layoutWith(2))
    act(() => result.current.edit('{ not valid'))
    expect(setLayout).not.toHaveBeenCalled()
    expect(result.current.text).toBe('{ not valid')
    expect(result.current.errors.length).toBeGreaterThan(0)
  })

  it('does NOT clobber an in-progress invalid edit when the store layout changes', () => {
    // The reported bug: type bad JSON (rejected, kept in the buffer), then move a
    // node on the canvas — the store layout changes underneath the editor.
    const { result, rerender } = mount(layoutWith(2))
    act(() => result.current.edit('{ oops'))
    expect(result.current.text).toBe('{ oops')
    act(() => rerender({ layout: layoutWith(9) })) // node drag mutates the store
    expect(result.current.text).toBe('{ oops') // unsaved edit survives
  })

  it('follows the store layout when the buffer is clean (a drag updates the editor)', () => {
    const { result, rerender } = mount(layoutWith(2))
    act(() => rerender({ layout: layoutWith(9) }))
    expect(JSON.parse(result.current.text)).toEqual(layoutWith(9))
  })

  it('does not reformat a valid edit once the store catches up (no caret jump)', () => {
    const { result, rerender } = mount(layoutWith(2))
    const compact = JSON.stringify(layoutWith(7)) // single-line, no indentation
    act(() => result.current.edit(compact))
    // App re-renders with the store now holding the edited layout.
    act(() => rerender({ layout: layoutWith(7) }))
    expect(result.current.text).toBe(compact) // left exactly as typed
  })

  it('reset() lets a freshly loaded document replace a dirty buffer', () => {
    const { result, rerender } = mount(layoutWith(2))
    act(() => result.current.edit('{ broken'))
    expect(result.current.text).toBe('{ broken')
    // Loading a new doc: clear the latch, then the store layout swaps in.
    act(() => {
      result.current.reset()
      rerender({ layout: layoutWith(50) })
    })
    expect(JSON.parse(result.current.text)).toEqual(layoutWith(50))
  })

  it('recovers once an invalid edit is corrected', () => {
    const { result, rerender, setLayout } = mount(layoutWith(2))
    act(() => result.current.edit('{ oops'))
    act(() => rerender({ layout: layoutWith(9) })) // a drag arrives while invalid
    expect(result.current.text).toBe('{ oops') // still preserved
    const fixed = JSON.stringify(layoutWith(4), null, 2)
    act(() => result.current.edit(fixed)) // user fixes the JSON
    expect(setLayout).toHaveBeenLastCalledWith(layoutWith(4))
    // Buffer is clean again, so the next store change is followed.
    act(() => rerender({ layout: layoutWith(11) }))
    expect(JSON.parse(result.current.text)).toEqual(layoutWith(11))
  })
})
