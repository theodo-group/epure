import { describe, expect, it } from 'vitest'

import { minimalDocChange } from './CodeMirrorPane'

// Applying the change to `current` must reproduce `next`, and the touched span
// must be as tight as the shared prefix/suffix allow — that tightness is what
// keeps a remote edit from dragging the caret to the top of the document.
const apply = (current: string, ch: { from: number; to: number; insert: string }) =>
  current.slice(0, ch.from) + ch.insert + current.slice(ch.to)

describe('minimalDocChange', () => {
  it('reports an empty middle change when nothing differs', () => {
    const ch = minimalDocChange('abc', 'abc')
    expect(ch).toEqual({ from: 3, to: 3, insert: '' })
  })

  it('narrows to the differing middle, sparing the shared prefix and suffix', () => {
    const current = 'node one\nnode two\nnode three\n'
    const next = 'node one\nnode TWO\nnode three\n'
    const ch = minimalDocChange(current, next)
    // Only the "two"→"TWO" span is replaced; the leading lines are untouched, so
    // a caret before it keeps its position.
    expect(current.slice(ch.from, ch.to)).toBe('two')
    expect(ch.insert).toBe('TWO')
    expect(apply(current, ch)).toBe(next)
  })

  it('handles a pure append (typing at the end)', () => {
    const ch = minimalDocChange('a -> b', 'a -> b\nc')
    expect(ch.from).toBe(6)
    expect(ch.to).toBe(6)
    expect(ch.insert).toBe('\nc')
    expect(apply('a -> b', ch)).toBe('a -> b\nc')
  })

  it('handles a pure prefix insert', () => {
    const ch = minimalDocChange('b\n', 'a\nb\n')
    expect(ch.from).toBe(0)
    expect(apply('b\n', ch)).toBe('a\nb\n')
  })

  it('handles deletion', () => {
    const ch = minimalDocChange('abcXYZdef', 'abcdef')
    expect(ch.insert).toBe('')
    expect(apply('abcXYZdef', ch)).toBe('abcdef')
  })

  it('does not let prefix and suffix overlap on a repeated run', () => {
    // "aaaa" → "aaaaa": prefix eats 4, suffix must not double-count.
    const ch = minimalDocChange('aaaa', 'aaaaa')
    expect(apply('aaaa', ch)).toBe('aaaaa')
    expect(ch.insert.length).toBe(1)
  })

  it('round-trips a full replacement', () => {
    const ch = minimalDocChange('completely old', 'entirely new text')
    expect(apply('completely old', ch)).toBe('entirely new text')
  })
})
