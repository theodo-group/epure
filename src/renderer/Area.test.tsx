// @vitest-environment jsdom
//
// The group-title editor must commit on a click-away even when the canvas
// background's mousedown preventDefaults (so the input never blurs).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AreaLabelInput } from './Area'

afterEach(cleanup)

describe('AreaLabelInput', () => {
  it('commits once on an outside mousedown that prevents blur', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(<AreaLabelInput initialLabel="Old" style={{}} onCommit={onCommit} onCancel={onCancel} />)
    const input = screen.getByLabelText('Group title') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  New  ' } })
    document.body.addEventListener('mousedown', (e) => e.preventDefault(), { once: true })
    fireEvent.mouseDown(document.body)
    expect(onCommit).toHaveBeenCalledWith('New')
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on dismiss without edit when the label has a newline', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <AreaLabelInput initialLabel={'A\nB'} style={{}} onCommit={onCommit} onCancel={onCancel} />,
    )
    fireEvent.blur(screen.getByLabelText('Group title'))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('stays open with the typed title when the commit is refused, and retries', () => {
    const onCommit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const onCancel = vi.fn()
    render(<AreaLabelInput initialLabel="Old" style={{}} onCommit={onCommit} onCancel={onCancel} />)
    const input = screen.getByLabelText('Group title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('New')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.mouseDown(document.body)
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
