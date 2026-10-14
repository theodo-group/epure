// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SplitPane } from './SplitPane'

const renderSplit = () =>
  render(
    <SplitPane
      defaultLeft={36}
      minLeft={20}
      minRight={30}
      left={<div>code</div>}
      right={<div>canvas</div>}
    />,
  )
const separator = () => screen.getByRole('separator', { name: 'Resize the code pane' })
// The split as assistive tech reads it: the separator's current value, in percent.
const split = () => Number(separator().getAttribute('aria-valuenow'))

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SplitPane', () => {
  it('starts at the default split, announcing its limits', () => {
    renderSplit()
    expect(split()).toBe(36)
    expect(separator().getAttribute('aria-valuemin')).toBe('20')
    expect(separator().getAttribute('aria-valuemax')).toBe('70')
  })

  it('resizes with the keyboard, clamped to both minimums, and remembers it', () => {
    renderSplit()
    fireEvent.keyDown(separator(), { key: 'ArrowRight' })
    expect(split()).toBe(38)
    fireEvent.keyDown(separator(), { key: 'End' })
    expect(split()).toBe(70) // 100 - minRight
    fireEvent.keyDown(separator(), { key: 'Home' })
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' })
    expect(split()).toBe(20) // never below minLeft
    cleanup()
    renderSplit()
    expect(split()).toBe(20)
  })

  it('follows a pointer drag, clamped, and remembers where the drag ended', () => {
    // jsdom has no layout or pointer capture: give the row a 1000px box at x=100.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 0, width: 1000, height: 600 }),
    )
    HTMLElement.prototype.setPointerCapture ??= () => {}
    HTMLElement.prototype.releasePointerCapture ??= () => {}

    renderSplit()
    const handle = separator()
    // A move before any press is not a drag.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })
    expect(split()).toBe(36)

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 460 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 }) // (600 - 100) / 1000
    expect(split()).toBe(50)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1050 }) // past the right minimum
    expect(split()).toBe(70)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 550 })
    expect(split()).toBe(45)
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 550 })

    // After release, moves no longer resize…
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 })
    expect(split()).toBe(45)
    // …and the drop position survives a reload.
    cleanup()
    renderSplit()
    expect(split()).toBe(45)
  })

  it('ignores a secondary-button press', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 600 }),
    )
    renderSplit()
    fireEvent.pointerDown(separator(), { pointerId: 1, button: 2, clientX: 500 })
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 500 })
    expect(split()).toBe(36)
  })

  it('picks up the split saved by react-resizable-panels (≤ 0.6.0)', () => {
    localStorage.setItem(
      'react-resizable-panels:epure:panels',
      JSON.stringify({ editor: 50, canvas: 50 }),
    )
    renderSplit()
    expect(split()).toBe(50)
  })

  it('clamps a saved split that no longer fits the limits', () => {
    localStorage.setItem('epure:ui:split:v1', '95')
    renderSplit()
    expect(split()).toBe(70)
  })
})
