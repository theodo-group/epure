import { describe, expect, it } from 'vitest'

import { hasRichMarkup, parseRichText, wrapRichText } from './richText'

describe('parseRichText — lists', () => {
  it('renders each <li> as a bullet line', () => {
    const lines = parseRichText('Head<ul><li>a</li><li>b</li></ul>')
    expect(lines).toEqual([
      { words: [{ text: 'Head' }] },
      { words: [{ text: 'a' }], bullet: true },
      { words: [{ text: 'b' }], bullet: true },
    ])
  })

  it('does not emit a leading blank line when the label starts with a list', () => {
    const lines = parseRichText('<ul><li>only</li></ul>')
    expect(lines).toEqual([{ words: [{ text: 'only' }], bullet: true }])
  })

  it('returns to an ordinary line after </ul>', () => {
    const lines = parseRichText('<ul><li>a</li></ul>tail')
    expect(lines).toEqual([
      { words: [{ text: 'a' }], bullet: true },
      { words: [{ text: 'tail' }] },
    ])
  })

  it('keeps inline styles inside list items', () => {
    const lines = parseRichText('<ul><li><b>bold</b></li></ul>')
    expect(lines).toEqual([
      { words: [{ text: 'bold', bold: true }], bullet: true },
    ])
  })
})

describe('hasRichMarkup', () => {
  it('is true for list markup', () => {
    expect(hasRichMarkup('<ul><li>a</li></ul>')).toBe(true)
  })
})

describe('wrapRichText — bullets', () => {
  it('keeps the bullet on only the first wrapped segment', () => {
    const lines = wrapRichText(
      [{ words: [{ text: 'aaa' }, { text: 'bbb' }], bullet: true }],
      4,
    )
    expect(lines).toEqual([
      { words: [{ text: 'aaa' }], bullet: true },
      { words: [{ text: 'bbb' }] },
    ])
  })
})
