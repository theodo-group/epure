import { describe, expect, it } from 'vitest'

import { editorHtmlToLabel, labelToEditorHtml, quoteD2 } from './labelMarkup'

const fromHtml = (html: string): HTMLElement => {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

describe('labelToEditorHtml', () => {
  it('passes recognised tags through, canonicalising strong/em', () => {
    expect(labelToEditorHtml('<b>Hi</b>')).toBe('<b>Hi</b>')
    expect(labelToEditorHtml('<strong>Hi</strong>')).toBe('<b>Hi</b>')
    expect(labelToEditorHtml('<em>Hi</em>')).toBe('<i>Hi</i>')
    expect(labelToEditorHtml('<small>x</small>')).toBe('<small>x</small>')
  })

  it('turns real newlines into <br>', () => {
    expect(labelToEditorHtml('a\nb')).toBe('a<br>b')
  })

  it('escapes text so a stray < can never become live markup', () => {
    expect(labelToEditorHtml('a < b & c')).toBe('a &lt; b &amp; c')
    // An unrecognised tag is escaped rather than emitted.
    expect(labelToEditorHtml('<script>x</script>')).toBe(
      '&lt;script&gt;x&lt;/script&gt;',
    )
  })

  it('keeps list markup', () => {
    expect(labelToEditorHtml('<ul><li>a</li><li>b</li></ul>')).toBe(
      '<ul><li>a</li><li>b</li></ul>',
    )
  })
})

describe('editorHtmlToLabel', () => {
  it('serializes inline formatting back to the label subset', () => {
    expect(editorHtmlToLabel(fromHtml('<b>Foo</b><br><small>bar</small>'))).toBe(
      '<b>Foo</b><br><small>bar</small>',
    )
  })

  it('normalises strong/em to b/i', () => {
    expect(editorHtmlToLabel(fromHtml('<strong>a</strong><em>b</em>'))).toBe(
      '<b>a</b><i>b</i>',
    )
  })

  it('treats block elements (div/p) as line breaks', () => {
    expect(editorHtmlToLabel(fromHtml('line1<div>line2</div><div>line3</div>'))).toBe(
      'line1<br>line2<br>line3',
    )
  })

  it('trims a trailing run of <br> and surrounding whitespace', () => {
    expect(editorHtmlToLabel(fromHtml('Foo<br>'))).toBe('Foo')
    expect(editorHtmlToLabel(fromHtml('  Foo  '))).toBe('Foo')
    // Two trailing breaks (blank line the user added) collapse away, not just one.
    expect(editorHtmlToLabel(fromHtml('Foo<br><br>'))).toBe('Foo')
    // Chrome's "exit the list" DOM leaves a trailing empty block after the <ul>.
    expect(
      editorHtmlToLabel(fromHtml('<ul><li>a</li><li>b</li></ul><div><br></div>')),
    ).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('preserves a leading break so re-serialization stays idempotent', () => {
    expect(editorHtmlToLabel(fromHtml('<br>Foo'))).toBe('<br>Foo')
  })

  it('canonicalises non-canonical stored labels (the no-op-commit guard basis)', () => {
    // App skips the write when the edit equals this canonical round-trip.
    const canon = (l: string) =>
      editorHtmlToLabel(fromHtml(labelToEditorHtml(l)))
    expect(canon('<strong>Auth</strong>')).toBe('<b>Auth</b>')
    expect(canon('<em>x</em>')).toBe('<i>x</i>')
    expect(canon('a\nb')).toBe('a<br>b')
    expect(canon('  spaced  ')).toBe('spaced')
  })

  it('recovers bold/italic from CSS-styled spans', () => {
    expect(
      editorHtmlToLabel(fromHtml('<span style="font-weight: 700">x</span>')),
    ).toBe('<b>x</b>')
    expect(
      editorHtmlToLabel(fromHtml('<span style="font-style: italic">y</span>')),
    ).toBe('<i>y</i>')
  })

  it('drops empty format wrappers', () => {
    expect(editorHtmlToLabel(fromHtml('<b></b>text'))).toBe('text')
  })

  it('serializes lists, ignoring stray whitespace between items', () => {
    expect(
      editorHtmlToLabel(fromHtml('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')),
    ).toBe('<ul><li>a</li><li>b</li></ul>')
  })
})

describe('quoteD2', () => {
  it('wraps in double quotes and escapes specials', () => {
    expect(quoteD2('Hi')).toBe('"Hi"')
    expect(quoteD2('say "hi"')).toBe('"say \\"hi\\""')
    expect(quoteD2('a\\b')).toBe('"a\\\\b"')
    expect(quoteD2('a\nb')).toBe('"a\\nb"')
  })
})

describe('round-trip: label → editor HTML → label', () => {
  const cases = [
    'Plain label',
    '<b>Traefik</b><br><small>proxy prod</small>',
    'Head<br><i>sub</i>',
    '<ul><li>auth</li><li>billing</li></ul>',
    'a & b < c',
  ]
  for (const label of cases) {
    it(JSON.stringify(label), () => {
      const roundTripped = editorHtmlToLabel(fromHtml(labelToEditorHtml(label)))
      expect(roundTripped).toBe(label)
    })
  }
})
