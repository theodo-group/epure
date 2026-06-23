import { StreamLanguage, LanguageSupport } from '@codemirror/language'
import type { StringStream } from '@codemirror/language'

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

  token(stream: StringStream, state: D2State): string | null {
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

export const d2Support = new LanguageSupport(d2Language)
