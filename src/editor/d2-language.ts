import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language'
import type { StringStream } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

interface D2State {
  inBlockComment: boolean
}

const SHAPE_KEYWORDS = new Set([
  'shape',
  'style',
  'stroke-dash',
  'stroke',
  'fill',
  'label',
  'direction',
])

const SHAPE_VALUES = new Set([
  'rectangle',
  'cylinder',
  'cloud',
  'person',
  'queue',
  'document',
  'page',
])

const isIdStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdPart = (c: string) => /[A-Za-z0-9_-]/.test(c)

export const d2Language = StreamLanguage.define<D2State>({
  name: 'd2',
  startState: () => ({ inBlockComment: false }),

  token(stream: StringStream, _state: D2State): string | null {
    // Whitespace
    if (stream.eatSpace()) return null

    // Line comment
    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }

    const ch = stream.peek()
    if (ch === undefined) return null

    // String literal (double-quoted)
    if (ch === '"') {
      stream.next()
      let escaped = false
      while (!stream.eol()) {
        const c = stream.next()
        if (escaped) {
          escaped = false
          continue
        }
        if (c === '\\') {
          escaped = true
          continue
        }
        if (c === '"') break
      }
      return 'string'
    }

    // Arrows: ->, <-, <->, --
    if (stream.match('<->')) return 'operator'
    if (stream.match('->')) return 'operator'
    if (stream.match('<-')) return 'operator'
    if (stream.match('--')) return 'operator'

    // Braces, brackets, punctuation
    if (stream.match(/^[{}]/)) return 'brace'
    if (stream.match(/^[:;,.]/)) return 'punctuation'

    // Numbers
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number'

    // Identifiers / keywords
    if (isIdStart(ch)) {
      let word = ''
      while (!stream.eol()) {
        const next = stream.peek()
        if (next === null || next === undefined || !isIdPart(next)) break
        word += stream.next()
      }
      if (SHAPE_KEYWORDS.has(word)) return 'keyword'
      if (SHAPE_VALUES.has(word)) return 'atom'
      return 'variableName'
    }

    // Anything else: advance one char and bail
    stream.next()
    return null
  },

  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
})

// Dark-palette highlight style, matching the editor's dark theme.
const d2HighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: '#6a7280', fontStyle: 'italic' },
  { tag: t.string, color: '#a3e2a7' },
  { tag: t.number, color: '#f3c969' },
  { tag: t.keyword, color: '#c792ea', fontWeight: '600' },
  { tag: t.atom, color: '#82aaff' },
  { tag: t.operator, color: '#ff9d6f' },
  { tag: t.bracket, color: '#9ca3af' },
  { tag: t.punctuation, color: '#9ca3af' },
  { tag: t.variableName, color: '#e6edf3' },
])

export const d2Support = new LanguageSupport(d2Language, [
  syntaxHighlighting(d2HighlightStyle),
])
