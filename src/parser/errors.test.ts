// @vitest-environment node
//
// Every error the parser reports, pinned to its exact message and range.
//
// Each row is `[source, ...errors]`, an error being `message @ range` with the
// range as `startLine:startColumn-endLine:endColumn` (1-based, end exclusive) —
// what the editor gutter underlines and what `epure validate` and the bridge
// print as `line:col`. The rows assert the WHOLE error list, in order, so an
// extra, missing or reordered error fails too.
//
// The second table pins boundaries of what is accepted.

import { describe, expect, it } from 'vitest'

import type { Diagram, ParseError } from './ast'
import { parse } from './index'

type Row = [source: string, ...errors: string[]]

const show = (e: ParseError): string => {
  const { start, end } = e.range
  return `${e.message} @ ${start.line}:${start.column}-${end.line}:${end.column}`
}

const errorsOf = (src: string): string[] => {
  const r = parse(src)
  return r.ok ? [] : r.errors.map(show)
}

const table = (name: string, rows: Row[]) =>
  describe(name, () => {
    it.each(rows)('%j', (src, ...expected) => {
      expect(errorsOf(src)).toEqual(expected)
    })
  })

table('lexer: characters no token starts with', [
  ['a @ b', 'Unexpected character `@` @ 1:3-1:4'],
  // A run of bad characters is one error covering the run.
  ['a: 日本語 x', 'Unexpected characters `日本語` @ 1:4-1:7'],
  // The lexer keeps going: the label still parses around the bad character.
  ['a: Hello, world', 'Unexpected character `,` @ 1:9-1:10'],
  ['a - b', 'Unexpected character `-` @ 1:3-1:4'],
  // An id can't end in a hyphen.
  ['a-', 'Unexpected character `-` @ 1:2-1:3'],
  // A backtick is quoted with single quotes.
  ['a: `x`', "Unexpected character '`' @ 1:4-1:5", "Unexpected character '`' @ 1:6-1:7"],
  // Invisible characters are named by code point: a byte-order mark, a
  // non-breaking space, a combining accent (a decomposed `é`).
  ['\uFEFFa', 'Unexpected character U+FEFF @ 1:1-1:2'],
  ['a\u00A0b', 'Unexpected character U+00A0 @ 1:2-1:3'],
  ['Cafe\u0301', 'Unexpected character U+0301 @ 1:5-1:6'],
  // Columns count UTF-16 code units, like the editor's offsets.
  ['a: 😀', 'Unexpected character `😀` @ 1:4-1:6', 'Expected a label after `a:` @ 1:6-1:7'],
])

table('lexer: unterminated strings', [
  ['a: "abc', 'Unterminated string — add a closing `"` @ 1:4-1:5'],
  ["a: 'x", "Unterminated string — add a closing `'` @ 1:4-1:5"],
  // A string can't span lines.
  [
    'a: "x\ny"',
    'Unterminated string — add a closing `"` @ 1:4-1:5',
    'Unterminated string — add a closing `"` @ 2:2-2:3',
  ],
  // An escaped quote doesn't close the string.
  [
    'a: "x\\"',
    'Unterminated string — add a closing `"` @ 1:4-1:5',
    'Unexpected characters `\\"` @ 1:6-1:8',
  ],
])

table('a line that cannot start a statement', [
  ['}', 'Unexpected `}` — no block is open @ 1:1-1:2'],
  ['a\n}', 'Unexpected `}` — no block is open @ 2:1-2:2'],
  ['-> b', 'Expected a node id before `->` @ 1:1-1:3'],
  ['a\n<- b', 'Expected a node id before `<-` @ 2:1-2:3'],
  [': x', 'Expected a node id before `:` @ 1:1-1:2'],
  ['{', 'Expected a node id before `{` @ 1:1-1:2'],
  [';', 'Unexpected `;` outside a block @ 1:1-1:2'],
  ['.a', 'Expected a node id, found `.` @ 1:1-1:2'],
  ['1 -> 2', 'Expected a node id, found `1` — ids start with a letter or `_` @ 1:1-1:2'],
  ['"a" -> b', 'Expected a node id, found `"a"` — ids are not quoted @ 1:1-1:4'],
])

table('input left after a statement on its line', [
  ['a }', 'Unexpected `}` — no block is open @ 1:3-1:4'],
  ['a;b', 'Unexpected `;` outside a block @ 1:2-1:3'],
  ['a: Web 2', 'Unexpected `2` in an unquoted label — wrap the label in quotes @ 1:8-1:9'],
  ['a: x: y', 'Unexpected `:` in an unquoted label — wrap the label in quotes @ 1:5-1:6'],
  ['a: x.y', 'Unexpected `.` in an unquoted label — wrap the label in quotes @ 1:5-1:6'],
  ['a -> b: x -> c', 'Unexpected `->` in an unquoted label — wrap the label in quotes @ 1:11-1:13'],
  ['a -> b -> c', "Edge chains aren't supported — write one edge per line @ 1:8-1:10"],
  ['a "x"', 'Expected `:` before the label `"x"` @ 1:3-1:6'],
  ['a -> b "x"', 'Expected `:` before the label `"x"` @ 1:8-1:11'],
  ['a.b -> c', "Unexpected `.` — ids can't contain dots @ 1:2-1:3"],
  ['a: "x" 3', 'Unexpected `3` @ 1:8-1:9'],
  ['a {} {', 'Unexpected `{` @ 1:6-1:7'],
  // Long tokens are cut short in the message.
  ['a: "0123456789012345678901234" 3', 'Unexpected `3` @ 1:32-1:33'],
  ['a 1234567890123456789012345', 'Unexpected `12345678901234567890…` @ 1:3-1:28'],
  // The statements before the stray input are whole, so their semantic
  // errors are reported too, after the syntax error.
  [
    'a\na\n}',
    'Unexpected `}` — no block is open @ 3:1-3:2',
    'Duplicate id `a` — first declared on line 1 @ 2:1-2:2',
  ],
])

table('labels', [
  // At the end of input the range sits one character past the end.
  ['a:', 'Expected a label after `a:` @ 1:3-1:4'],
  ['a\njean_claude:', 'Expected a label after `jean_claude:` @ 2:13-2:14'],
  // At the end of a line it underlines the line break.
  ['a:\nb', 'Expected a label after `a:` @ 1:3-1:4'],
  ['a: 3', 'Expected a label after `a:` — quote labels that start with a digit @ 1:4-1:5'],
  ['x: {', 'Expected a label after `x:` — drop the `:` to open a block directly @ 1:4-1:5'],
  ['a -> b: ;', 'Expected a label after `a -> b:`, found `;` @ 1:9-1:10'],
])

table('edges', [
  ['a ->', 'Expected a node id after `->` @ 1:5-1:6'],
  ['a --\nb', 'Expected a node id after `--` @ 1:5-1:6'],
  ['a -> "b"', 'Expected a node id after `->`, found `"b"` @ 1:6-1:9'],
  ['a <-> 1', 'Expected a node id after `<->`, found `1` @ 1:7-1:8'],
])

table('attributes', [
  ['a { style. }', 'Expected an attribute name after `style.`, found `}` @ 1:12-1:13'],
  ['a { style.', 'Expected an attribute name after `style.` @ 1:11-1:12'],
  ['a { style.fill red }', 'Expected `:` after `style.fill`, found `red` @ 1:16-1:19'],
  ['a {\n  style.fill\n}', 'Expected `:` after `style.fill` @ 2:13-2:14'],
  ['a { shape: }', 'Expected a value after `shape:`, found `}` @ 1:12-1:13'],
  ['a { shape:', 'Expected a value after `shape:` @ 1:11-1:12'],
  ['a { shape: {', 'Expected a value after `shape:`, found `{` @ 1:12-1:13'],
  // An edge block only takes attributes, so a bare word is a missing `:`.
  ['a -> b { foo }', 'Expected `:` after `foo` — edge blocks only hold attributes @ 1:14-1:15'],
  ['a -> b { style.stroke-dash }', 'Expected `:` after `style.stroke-dash`, found `}` @ 1:28-1:29'],
])

table('blocks', [
  ['a {', 'Expected `}` to close the `a` block @ 1:4-1:5'],
  ['a {\n', 'Expected `}` to close the `a` block @ 2:1-2:2'],
  ['a: b {\n\n', 'Expected `}` to close the `a` block @ 3:1-3:2'],
  ['Services: "Services" {\n  api\n', 'Expected `}` to close the `Services` block @ 3:1-3:2'],
  ['a -> b {', 'Expected `}` to close the `a -> b` block @ 1:9-1:10'],
  ['g { a -> b }', 'Unexpected `->` in the `g` block — edges go at top level @ 1:7-1:9'],
  // `a--b` is not one id (no doubled hyphen): it is `a`, `--`, `b`.
  ['g {\n  a--b\n}', 'Unexpected `--` in the `g` block — edges go at top level @ 2:4-2:6'],
  ['g { "x" }', 'Unexpected `"x"` in the `g` block @ 1:5-1:8'],
  // A member followed by `{` would be a literal nested container, which the
  // grammar forbids: nesting is by REFERENCE (declare `inner` as its own area
  // and list its id as a member of `g`).
  [
    'g: G {\n  inner: I {\n    a\n  }\n}',
    "Unexpected `{` — blocks can't nest; declare it at top level and list its id in `g` @ 2:12-2:13",
  ],
  ['a -> b { x: 1 {', "Unexpected `{` — blocks can't nest @ 1:15-1:16"],
  // A syntax error inside a statement stops the parse: the duplicate `a`
  // before it is not reported.
  ['a\na\nb {', 'Expected `}` to close the `b` block @ 3:4-3:5'],
])

table('semantic checks', [
  ['a\na', 'Duplicate id `a` — first declared on line 1 @ 2:1-2:2'],
  ['x\n\n# c\nx { shape: person }', 'Duplicate id `x` — first declared on line 1 @ 4:1-4:20'],
  // An area and a node share one id space.
  ['g { a }\ng', 'Duplicate id `g` — first declared on line 1 @ 2:1-2:2'],
  [
    'a { shape: triangle }',
    'Unknown shape `triangle` on `a` — use rectangle, cylinder or person @ 1:5-1:20',
  ],
  ['a { shape: "" }', 'Unknown shape `""` on `a` — use rectangle, cylinder or person @ 1:5-1:14'],
  // Dotted attributes: up to two segments are accepted (and ignored) on a
  // node, three are rejected, on a node as on an edge.
  ['a { style.x.y: 1 }', 'Unsupported dotted attribute `style.x.y` on `a` @ 1:5-1:17'],
  [
    'a -> b { style.stroke.foo: 1 }',
    'Unsupported dotted attribute `style.stroke.foo` on `a -> b` @ 1:10-1:29',
  ],
  [
    'a {\n  b\n  c: 1\n}',
    'Block `a` mixes attributes and members — an area lists only member ids @ 1:1-4:2',
  ],
  ['g { a; a }', 'Area `g` already lists `a` @ 1:8-1:9'],
  ['g {\n  a\n  b\n  a\n}', 'Area `g` already lists `a` @ 4:3-4:4'],
  ['a\nbox: B {\n  a\n  box\n}', "Area `box` can't contain itself @ 4:3-4:6"],
  [
    'a\nb\nx: X {\n  a\n  y\n}\ny: Y {\n  b\n  x\n}',
    'Membership cycle — `y` contains `x`, which already contains `y` @ 9:3-9:4',
  ],
])

// Line breaks count as an editor shows them: `\n`, `\r\n` and a lone `\r`
// are one line each. The `\r` of a CRLF is whitespace, so it takes a column
// at the end of its line.
table('line breaks', [
  ['a\r\nb\r\n}', 'Unexpected `}` — no block is open @ 3:1-3:2'],
  ['a\r\n\r\n\r\n  @', 'Unexpected character `@` @ 4:3-4:4'],
  ['a:\r\nb', 'Expected a label after `a:` @ 1:4-1:5'],
  ['a\r\nb {', 'Expected `}` to close the `b` block @ 2:4-2:5'],
  ['a {\r\n', 'Expected `}` to close the `a` block @ 2:1-2:2'],
  ['a\r  @', 'Unexpected character `@` @ 2:3-2:4'],
  ['a\r{', 'Expected `}` to close the `a` block @ 2:2-2:3'],
  ['a\n\n\n}', 'Unexpected `}` — no block is open @ 4:1-4:2'],
])

describe('messages', () => {
  it('are single-line (the gutter joins them on one line)', () => {
    const sources = ['a {', 'a:', 'a -> b { foo }', 'a: "x\ny', 'a\n\n}', 'a { shape: }']
    for (const src of sources) {
      for (const line of errorsOf(src)) expect(line).not.toMatch(/\n/)
    }
  })
})

// --- accepted inputs --------------------------------------------------------

const diagramOf = (src: string): Diagram => {
  const r = parse(src)
  if (!r.ok) throw new Error(r.errors.map(show).join('\n'))
  return r.diagram
}

describe('accepted: identifiers', () => {
  it('takes accented letters in ids and unquoted labels', () => {
    const d = diagramOf('Café -> Niño\nMüller: Ñandú Señor')
    expect(d.edges[0]).toMatchObject({ source: 'Café', target: 'Niño' })
    expect(d.nodes[0]).toMatchObject({ id: 'Müller', label: 'Ñandú Señor' })
  })

  it('takes single internal hyphens in ids', () => {
    const d = diagramOf('my-node -> b-2')
    expect(d.edges[0]).toMatchObject({ source: 'my-node', target: 'b-2', direction: 'forward' })
  })

  it('reads `a--b` at top level as an undirected edge, not an id', () => {
    const d = diagramOf('a--b')
    expect(d.nodes).toEqual([])
    expect(d.edges[0]).toMatchObject({ source: 'a', target: 'b', direction: 'none' })
  })
})

describe('accepted: node attributes', () => {
  it.each(['a { style.fill: red }', 'a { shape.x: 1 }', 'a { color: blue }'])(
    'ignores the unknown attribute in %j',
    (src) => {
      expect(diagramOf(src).nodes[0]).toMatchObject({ id: 'a', shape: 'rectangle' })
    },
  )
})

describe('accepted: style.stroke-dash', () => {
  it.each([
    ['0', 'solid'],
    ['1', 'dotted'],
    ['3', 'dotted'],
    ['3.5', 'dashed'],
    ['4', 'dashed'],
    ['"3"', 'dotted'],
    ['x', 'solid'],
  ])('stroke-dash: %s is %s', (value, style) => {
    expect(diagramOf(`a -> b { style.stroke-dash: ${value} }`).edges[0]!.style).toBe(style)
  })
})
