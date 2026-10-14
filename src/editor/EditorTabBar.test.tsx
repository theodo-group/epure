// The code pane's tab-bar actions: Wrap toggles soft wrapping in the editor and
// remembers it across reloads; Format dispatches, or explains why it can't.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeMirrorPane } from './CodeMirrorPane'
import { EditorTabBar } from './EditorTabBar'
import { EDITOR_WRAP_KEY, useEditorWrap } from './wrapPreference'

const Pane = ({ onFormat, reason }: { onFormat?: () => void; reason?: string }) => {
  const [wrap, toggleWrap] = useEditorWrap()
  return (
    <>
      <EditorTabBar
        tabs={[{ id: 'd2', label: 'system.d2' }]}
        activeTabId="d2"
        onSelectTab={() => {}}
        wrap={wrap}
        onToggleWrap={toggleWrap}
        onFormat={onFormat}
        formatDisabledReason={reason}
      />
      <CodeMirrorPane value={`a: "${'long '.repeat(40)}"\n`} onChange={() => {}} wrap={wrap} />
    </>
  )
}

const wrapButton = () => screen.getByRole('button', { name: 'Wrap' })
const formatButton = () => screen.getByRole('button', { name: 'Format' })
const editorWraps = (container: HTMLElement) =>
  container.querySelector('.cm-content')!.classList.contains('cm-lineWrapping')

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Wrap', () => {
  it('is off by default', () => {
    const { container } = render(<Pane />)
    expect(wrapButton().getAttribute('aria-pressed')).toBe('false')
    expect(editorWraps(container)).toBe(false)
  })

  it('toggles soft wrapping in the editor and shows as pressed', () => {
    const { container } = render(<Pane />)
    fireEvent.click(wrapButton())
    expect(wrapButton().getAttribute('aria-pressed')).toBe('true')
    expect(editorWraps(container)).toBe(true)
    fireEvent.click(wrapButton())
    expect(wrapButton().getAttribute('aria-pressed')).toBe('false')
    expect(editorWraps(container)).toBe(false)
  })

  it('survives a reload', () => {
    render(<Pane />)
    fireEvent.click(wrapButton())
    expect(localStorage.getItem(EDITOR_WRAP_KEY)).toBe('1')
    cleanup()
    const { container } = render(<Pane />)
    expect(wrapButton().getAttribute('aria-pressed')).toBe('true')
    expect(editorWraps(container)).toBe(true)
  })

  it('still works when storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    try {
      const { container } = render(<Pane />)
      fireEvent.click(wrapButton())
      expect(editorWraps(container)).toBe(true)
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})

describe('Format', () => {
  it('dispatches on click, advertising its shortcut', () => {
    const onFormat = vi.fn()
    render(<Pane onFormat={onFormat} />)
    expect(formatButton().getAttribute('title')).toBe('Format (⇧⌥F)')
    fireEvent.click(formatButton())
    expect(onFormat).toHaveBeenCalledTimes(1)
  })

  it('is disabled, saying why, while the text does not parse', () => {
    const onFormat = vi.fn()
    render(<Pane onFormat={onFormat} reason="Fix the errors to format" />)
    expect((formatButton() as HTMLButtonElement).disabled).toBe(true)
    expect(formatButton().getAttribute('title')).toBe('Fix the errors to format')
    fireEvent.click(formatButton())
    expect(onFormat).not.toHaveBeenCalled()
  })
})
