// Tokens for the D2 subset.
//
// Newlines are significant (they terminate a statement) and therefore are NOT
// skipped — only horizontal whitespace and comments are. Identifiers allow
// internal hyphens (so we accept `style.stroke-dash` as Identifier + Dot +
// Identifier) but reject leading or doubled hyphens.

import { createToken, Lexer } from 'chevrotain'

// Skipped trivia ------------------------------------------------------------

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r]+/,
  group: Lexer.SKIPPED,
})

export const Comment = createToken({
  name: 'Comment',
  // `#` to end of line; the trailing newline stays so it can still act as a
  // statement terminator.
  pattern: /#[^\n]*/,
  group: Lexer.SKIPPED,
})

// Significant tokens --------------------------------------------------------

export const Newline = createToken({
  name: 'Newline',
  // Collapse consecutive newlines into one logical terminator.
  pattern: /\n+/,
  line_breaks: true,
})

// Multi-character operators must be declared before their single-character
// prefixes (e.g. `<->` before `<-`) so the longest match wins.
export const ArrowBoth = createToken({ name: 'ArrowBoth', pattern: /<->/ })
export const ArrowRight = createToken({ name: 'ArrowRight', pattern: /->/ })
export const ArrowLeft = createToken({ name: 'ArrowLeft', pattern: /<-/ })
export const DashDash = createToken({ name: 'DashDash', pattern: /--/ })

export const LCurly = createToken({ name: 'LCurly', pattern: /\{/ })
export const RCurly = createToken({ name: 'RCurly', pattern: /\}/ })
export const Colon = createToken({ name: 'Colon', pattern: /:/ })
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ })
export const Dot = createToken({ name: 'Dot', pattern: /\./ })

// Quoted strings (single or double) with simple backslash escapes.
export const StringLit = createToken({
  name: 'StringLit',
  pattern: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/,
})

// Numeric literal (integer or decimal, no sign — `-1` is not valid here).
export const NumberLit = createToken({
  name: 'NumberLit',
  pattern: /[0-9]+(?:\.[0-9]+)?/,
})

// Identifier: starts with a letter or underscore, then alnum/underscore, with
// optional internal single hyphens (`stroke-dash` ok, `a--b` not, `-x` not).
// Includes Latin-1 Supplement + Latin Extended ranges so accented characters
// (`Café`, `Niño`, `Müller`) work as either ids or unquoted labels.
const LETTER = 'A-Za-zÀ-ÿĀ-ɏ'
const DIGIT = '0-9'
export const Identifier = createToken({
  name: 'Identifier',
  pattern: new RegExp(
    `[${LETTER}_][${LETTER}${DIGIT}_]*(?:-[${LETTER}${DIGIT}_]+)*`,
  ),
})

// Token order matters: longer / more specific patterns come first.
export const allTokens = [
  WhiteSpace,
  Comment,
  Newline,
  ArrowBoth,
  ArrowRight,
  ArrowLeft,
  DashDash,
  LCurly,
  RCurly,
  Colon,
  Semicolon,
  Dot,
  StringLit,
  NumberLit,
  Identifier,
]

export const lexer = new Lexer(allTokens, {
  positionTracking: 'full',
  ensureOptimizations: false,
})
