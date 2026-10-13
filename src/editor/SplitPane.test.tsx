import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
const separator = () => screen.getByRole('separator')
const leftWidth = () => (separator().previousElementSibling as HTMLElement).style.flex

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('SplitPane', () => {
  it('starts at the default split', () => {
    renderSplit()
    expect(leftWidth()).toBe('0 0 36%')
    expect(separator().getAttribute('aria-valuenow')).toBe('36')
  })

  it('resizes with the keyboard, clamped to both minimums, and remembers it', () => {
    renderSplit()
    fireEvent.keyDown(separator(), { key: 'ArrowRight' })
    expect(leftWidth()).toBe('0 0 38%')
    fireEvent.keyDown(separator(), { key: 'End' })
    expect(leftWidth()).toBe('0 0 70%') // 100 - minRight
    fireEvent.keyDown(separator(), { key: 'Home' })
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' })
    expect(leftWidth()).toBe('0 0 20%') // never below minLeft
    cleanup()
    renderSplit()
    expect(leftWidth()).toBe('0 0 20%')
  })

  it('picks up the split saved by react-resizable-panels (≤ 0.6.0)', () => {
    localStorage.setItem(
      'react-resizable-panels:epure:panels',
      JSON.stringify({ editor: 50, canvas: 50 }),
    )
    renderSplit()
    expect(leftWidth()).toBe('0 0 50%')
  })

  it('clamps a saved split that no longer fits the limits', () => {
    localStorage.setItem('epure:ui:split:v1', '95')
    renderSplit()
    expect(leftWidth()).toBe('0 0 70%')
  })
})
