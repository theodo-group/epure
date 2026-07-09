// Conversions between a node label's D2 markup and the contentEditable DOM used
// by the inline WYSIWYG editor.
//
//   labelToEditorHtml  — D2 label string  → sanitized innerHTML for the editor
//   editorHtmlToLabel  — contentEditable DOM → D2 label markup string
//   quoteD2            — markup string → a D2 quoted-string literal for the .d2
//
// The label markup is a tiny HTML subset (see `@/renderer/richText`): the inline
// tags <b>/<i>/<small>, the void <br>, and the list tags <ul>/<li>. Both
// directions restrict themselves to that vocabulary so a round-trip
// (label → editor → label) is stable, and so nothing an editor produces can
// smuggle arbitrary HTML into the .d2 file.

import { LABEL_TAG_RE, tagKey } from '@/renderer/richText'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Turn a stored D2 label into safe HTML for the editor's contentEditable.
 * Recognised tags pass through canonicalised (`<strong>`→`<b>`, `<em>`→`<i>`);
 * a real newline becomes a `<br>`; every other character is HTML-escaped, so a
 * stray `<` the user typed can never become live markup.
 */
export const labelToEditorHtml = (label: string): string => {
  let out = ''
  let text = ''
  const flush = () => {
    if (text) {
      out += escapeHtml(text)
      text = ''
    }
  }
  let i = 0
  while (i < label.length) {
    const ch = label[i]!
    if (ch === '\n') {
      flush()
      out += '<br>'
      i++
      continue
    }
    if (ch === '<') {
      const m = label.slice(i).match(LABEL_TAG_RE)
      if (m) {
        flush()
        const key = tagKey(m[2]!)
        out += key === 'br' ? '<br>' : m[1] === '/' ? `</${key}>` : `<${key}>`
        i += m[0].length
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

// Serialize a run of inline content (inside <b>/<i>/<small>/<li>). Block
// elements aren't expected here; if one turns up it's flattened inline.
const serializeInline = (node: Node): string => {
  let out = ''
  node.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out
}

const wrap = (tag: string, inner: string): string =>
  inner ? `<${tag}>${inner}</${tag}>` : ''

const isBoldStyle = (el: HTMLElement): boolean => {
  const fw = el.style.fontWeight
  return fw === 'bold' || fw === 'bolder' || (!!fw && Number(fw) >= 600)
}

const isItalicStyle = (el: HTMLElement): boolean => {
  const fs = el.style.fontStyle
  return fs === 'italic' || fs === 'oblique'
}

const serializeNode = (node: Node): string => {
  // Text is emitted verbatim. The label format has no escape for a literal
  // "<b>"/"<br>" etc., so typing such text stores it as real markup and it
  // renders as formatting — identical to authoring it directly in the .d2.
  // This is a fidelity limitation, not an injection: the render path emits SVG
  // <tspan>s (never innerHTML) and quoteD2 keeps the .d2 string well-formed.
  if (node.nodeType === TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== ELEMENT_NODE) return ''
  const el = node as HTMLElement
  switch (el.tagName.toLowerCase()) {
    case 'br':
      return '<br>'
    case 'b':
    case 'strong':
      return wrap('b', serializeInline(el))
    case 'i':
    case 'em':
      return wrap('i', serializeInline(el))
    case 'small':
      return wrap('small', serializeInline(el))
    case 'ul':
    case 'ol':
      return wrap('ul', serializeList(el))
    case 'li':
      return wrap('li', serializeInline(el))
    case 'span':
    case 'font': {
      // Browsers that format with CSS (styleWithCSS) wrap runs in styled
      // spans instead of <b>/<i>; recover the intent from inline styles.
      let inner = serializeInline(el)
      if (isItalicStyle(el)) inner = wrap('i', inner)
      if (isBoldStyle(el)) inner = wrap('b', inner)
      return inner
    }
    default:
      return serializeInline(el)
  }
}

// A <ul> contributes only its <li> children; whitespace/text between items is
// dropped so the markup stays clean.
const serializeList = (ul: HTMLElement): string => {
  let out = ''
  ul.childNodes.forEach((child) => {
    if (
      child.nodeType === ELEMENT_NODE &&
      (child as HTMLElement).tagName.toLowerCase() === 'li'
    ) {
      out += wrap('li', serializeInline(child))
    }
  })
  return out
}

/**
 * Serialize the editor's contentEditable DOM back to a D2 label markup string.
 * Block elements (`<div>`/`<p>`, which some browsers emit on Enter) are treated
 * as line boundaries and collapsed to `<br>`. Leading whitespace and any
 * trailing run of `<br>`/whitespace are stripped — browsers append a "bogus"
 * trailing `<br>`, and leaving a bulleted list emits a trailing empty block, so
 * without this the label would carry a phantom blank line and re-serialization
 * wouldn't be idempotent.
 */
export const editorHtmlToLabel = (root: Node): string => {
  let out = ''
  const ensureBreak = () => {
    if (out.length > 0 && !out.endsWith('<br>')) out += '<br>'
  }
  const walk = (parent: Node) => {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName.toLowerCase()
        if (tag === 'div' || tag === 'p') {
          ensureBreak()
          walk(node)
          return
        }
      }
      out += serializeNode(node)
    })
  }
  walk(root)
  return out.replace(/^\s+/, '').replace(/(?:<br>|\s)+$/, '')
}

/** Encode a label markup string as a D2 double-quoted string literal. */
export const quoteD2 = (label: string): string => {
  const esc = label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${esc}"`
}
