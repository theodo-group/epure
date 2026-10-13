// Tokens for the D2 subset.
//
// Newlines are significant (they terminate a statement) and therefore are NOT
// skipped — only horizontal whitespace and comments are. Identifiers allow
// internal hyphens (so we accept `style.stroke-dash` as Identifier + Dot +
// Identifier) but reject leading or doubled hyphens.
//
// Matching is first-match in table order (not longest-match), so multi-char
// operators come before their single-char prefixes (`<->` before `<-`).
// Positions are 1-based lines/columns and 0-based offsets; a token's `end*`
// fields point AT its last character (inclusive), like the editor ranges built
// from them expect.

export type TokenKind =
  | 'Newline'
  | 'ArrowBoth'
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'DashDash'
  | 'LCurly'
  | 'RCurly'
  | 'Colon'
  | 'Semicolon'
  | 'Dot'
  | 'StringLit'
  | 'NumberLit'
  | 'Identifier'

export interface Token {
  kind: TokenKind
  image: string
  startOffset: number
  endOffset: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface LexError {
  message: string
  offset: number
  line: number
  column: number
  length: number
}

// Identifier: starts with a letter or underscore, then alnum/underscore, with
// optional internal single hyphens (`stroke-dash` ok, `a--b` not, `-x` not).
// Includes Latin-1 Supplement + Latin Extended ranges so accented characters
// (`Café`, `Niño`, `Müller`) work as either ids or unquoted labels.
const LETTER = 'A-Za-zÀ-ÿĀ-ɏ'
const DIGIT = '0-9'

interface Rule {
  /** `null` = skipped trivia (whitespace, comments). */
  kind: TokenKind | null
  pattern: RegExp
  /** Whether a match can contain a line break, which moves the line counter.
   *  Only whitespace (`\r`) and newlines do; a `\r` inside a comment or a
   *  string does not. */
  lineBreaks: boolean
}

const rule = (kind: TokenKind | null, pattern: RegExp, lineBreaks = false): Rule => ({
  kind,
  pattern,
  lineBreaks,
})

const RULES: Rule[] = [
  // Skipped trivia.
  rule(null, /[ \t\r]+/, true),
  // `#` to end of line; the trailing newline stays so it can still act as a
  // statement terminator.
  rule(null, /#[^\n]*/),
  // Consecutive newlines collapse into one logical terminator.
  rule('Newline', /\n+/, true),
  rule('ArrowBoth', /<->/),
  rule('ArrowRight', /->/),
  rule('ArrowLeft', /<-/),
  rule('DashDash', /--/),
  rule('LCurly', /\{/),
  rule('RCurly', /\}/),
  rule('Colon', /:/),
  rule('Semicolon', /;/),
  rule('Dot', /\./),
  // Quoted strings (single or double) with simple backslash escapes.
  rule('StringLit', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/),
  // Numeric literal (integer or decimal, no sign — `-1` is not valid here).
  rule('NumberLit', /[0-9]+(?:\.[0-9]+)?/),
  rule('Identifier', new RegExp(`[${LETTER}_][${LETTER}${DIGIT}_]*(?:-[${LETTER}${DIGIT}_]+)*`)),
]

// What counts as one line break inside a matched image: `\n`, `\r\n` or a lone
// `\r`. Lines are counted per break, so a CRLF file's `\r` (in whitespace) and
// `\n` (the Newline token) each advance the line — kept as-is so positions
// match what the editor has always received.
const LINE_BREAK = /\n|\r\n?/g

// All rules as one sticky alternation, one capture group per rule. Regex
// alternation is ordered (the first alternative that matches wins), which is
// exactly the table's first-match semantics — in a single `exec` per token.
const TOKEN = new RegExp(RULES.map((r) => `(${r.pattern.source})`).join('|'), 'y')

const matchAt = (source: string, offset: number): { rule: Rule; image: string } | null => {
  TOKEN.lastIndex = offset
  const m = TOKEN.exec(source)
  if (!m) return null
  const i = m.findIndex((g, idx) => idx > 0 && g !== undefined)
  return { rule: RULES[i - 1]!, image: m[0] }
}

export function tokenize(source: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = []
  const errors: LexError[] = []
  let offset = 0
  let line = 1
  let column = 1

  while (offset < source.length) {
    const match = matchAt(source, offset)

    if (!match) {
      // Skip characters until one can start a token again, and report the run
      // as a single error.
      const start = offset
      do offset++
      while (offset < source.length && !matchAt(source, offset))
      const length = offset - start
      errors.push({
        message: `unexpected character: ->${source.charAt(start)}<- at offset: ${start}, skipped ${length} characters.`,
        offset: start,
        line,
        column,
        length,
      })
      column += length
      continue
    }

    const { rule: r, image } = match
    const token: Token | null = r.kind
      ? {
          kind: r.kind,
          image,
          startOffset: offset,
          endOffset: offset + image.length - 1,
          startLine: line,
          startColumn: column,
          endLine: line,
          endColumn: column + image.length - 1,
        }
      : null
    if (token) tokens.push(token)

    offset += image.length
    column += image.length

    if (r.lineBreaks) {
      let breaks = 0
      let lastBreakEnd = -1
      LINE_BREAK.lastIndex = 0
      while (LINE_BREAK.exec(image)) {
        breaks++
        lastBreakEnd = LINE_BREAK.lastIndex - 1
      }
      if (breaks > 0) {
        line += breaks
        column = image.length - lastBreakEnd
        // A token that ends in its only line break keeps its one-line end; one
        // spanning several breaks ends on the line of its last character.
        const endsInBreak = lastBreakEnd === image.length - 1
        if (token && !(breaks === 1 && endsInBreak)) {
          token.endLine = endsInBreak ? line - 1 : line
          token.endColumn = endsInBreak ? column : column - 1
        }
      }
    }
  }

  return { tokens, errors }
}
