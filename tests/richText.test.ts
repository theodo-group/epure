import { describe, expect, it } from 'vitest'

import {
  hasRichMarkup,
  parseRichText,
  wrapRichText,
} from '@/renderer/richText'

describe('parseRichText', () => {
  it('returns a single line of plain words for an unstyled label', () => {
    const lines = parseRichText('hello world')
    expect(lines).toEqual([
      { words: [{ text: 'hello' }, { text: 'world' }] },
    ])
  })

  it('parses <b> / <strong> as bold and respects nesting', () => {
    expect(parseRichText('<b>Traefik</b>')).toEqual([
      { words: [{ text: 'Traefik', bold: true }] },
    ])
    expect(parseRichText('<strong>x</strong> y')).toEqual([
      { words: [{ text: 'x', bold: true }, { text: 'y' }] },
    ])
  })

  it('parses <i> / <em> as italic', () => {
    expect(parseRichText('<i>foo</i> <em>bar</em>')).toEqual([
      {
        words: [
          { text: 'foo', italic: true },
          { text: 'bar', italic: true },
        ],
      },
    ])
  })

  it('parses <small> for secondary text', () => {
    expect(parseRichText('<small>proxy prod</small>')).toEqual([
      {
        words: [
          { text: 'proxy', small: true },
          { text: 'prod', small: true },
        ],
      },
    ])
  })

  it('splits on <br> and <br/>', () => {
    expect(parseRichText('a<br>b')).toEqual([
      { words: [{ text: 'a' }] },
      { words: [{ text: 'b' }] },
    ])
    expect(parseRichText('a<br/>b<br />c')).toEqual([
      { words: [{ text: 'a' }] },
      { words: [{ text: 'b' }] },
      { words: [{ text: 'c' }] },
    ])
  })

  it('splits on literal newlines too', () => {
    expect(parseRichText('a\nb')).toEqual([
      { words: [{ text: 'a' }] },
      { words: [{ text: 'b' }] },
    ])
  })

  it('combines styles across a line break', () => {
    expect(parseRichText('<b>Traefik</b><br><small>proxy prod</small>')).toEqual(
      [
        { words: [{ text: 'Traefik', bold: true }] },
        {
          words: [
            { text: 'proxy', small: true },
            { text: 'prod', small: true },
          ],
        },
      ],
    )
  })

  it('treats an unrecognised tag as literal text', () => {
    const lines = parseRichText('<unknown>x</unknown>')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.words.map((w) => w.text).join(' ')).toBe(
      '<unknown>x</unknown>',
    )
  })
})

describe('hasRichMarkup', () => {
  it('detects supported tags and newlines', () => {
    expect(hasRichMarkup('hello')).toBe(false)
    expect(hasRichMarkup('<b>hi</b>')).toBe(true)
    expect(hasRichMarkup('a<br/>b')).toBe(true)
    expect(hasRichMarkup('a\nb')).toBe(true)
    expect(hasRichMarkup('<div>nope</div>')).toBe(false)
  })
})

describe('wrapRichText', () => {
  it('wraps long lines at the character budget while preserving styles', () => {
    const lines = parseRichText('<b>one two three four</b>')
    const wrapped = wrapRichText(lines, 7)
    // "one two" (7) | "three" (5) | "four" (4) — each bold
    expect(wrapped.map((l) => l.words.map((w) => w.text).join(' '))).toEqual([
      'one two',
      'three',
      'four',
    ])
    for (const l of wrapped) {
      for (const w of l.words) expect(w.bold).toBe(true)
    }
  })

  it('keeps hard line breaks as separate output lines', () => {
    const lines = parseRichText('aa bb<br>cc dd')
    const wrapped = wrapRichText(lines, 10)
    expect(wrapped.map((l) => l.words.map((w) => w.text).join(' '))).toEqual([
      'aa bb',
      'cc dd',
    ])
  })

  it('preserves empty lines from consecutive <br>', () => {
    const lines = parseRichText('a<br><br>b')
    expect(lines).toEqual([
      { words: [{ text: 'a' }] },
      { words: [] },
      { words: [{ text: 'b' }] },
    ])
    expect(wrapRichText(lines, 10)).toEqual(lines)
  })
})
