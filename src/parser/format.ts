// Canonical formatter for the D2 subset, built on the parser's own lexer and
// syntax tree (so it can never disagree with the parser about what a token is).
//
// House style:
//   - one statement per line; block items one per line, indented two spaces;
//     a block written on a single line stays inline (`{ shape: person }`),
//   - `id: label` with one space after `:`, ` -> ` (any arrow) between single
//     spaces, `a; b` between inline block items, no trailing whitespace,
//   - declarations (nodes, areas) first, then ONE blank line, then the edges,
//     each group keeping its statements' relative order,
//   - blank lines are kept where the author put them but runs collapse to one;
//     none right after `{` or right before `}`,
//   - exactly one final newline (an empty document stays empty).
//
// Comments are trivia to the lexer, so they are recovered from the gaps
// between tokens: a comment sharing a line with code stays a trailing comment
// on that line (`a -> b # why`); a comment on its own line travels with the
// statement (or block item, or closing `}`) it precedes. Comments before the
// first statement that are separated from it by a blank line are the file
// header and stay at the top; comments after the last statement stay at the
// end.
//
// Regrouping is safe because the builder keeps nodes, areas and edges in three
// separate lists, each in statement order, and never introduces a node from an
// edge (an undeclared endpoint stays a bare id on the edge) — moving the edges
// after the declarations changes none of the three lists. The formatter still
// checks this on every run: the output must parse to the same diagram (ranges
// aside), with the same statements and the same comments. If the regrouped
// text didn't, it falls back to formatting in the original statement order,
// and if even that failed it leaves the source untouched.

import type { Diagram, ParseError } from './ast'
import { parse } from './index'
import { type Token, tokenize } from './lexer'
import {
  type AttrSyntax,
  type BlockItemSyntax,
  type BlockSyntax,
  type LabelSyntax,
  parseTokens,
  type StatementSyntax,
} from './parser'

export type FormatResult =
  | {
      ok: true
      text: string
      /** `grouped`: declarations then edges; `original`: statement order kept
       *  (regrouping would have changed the diagram); `unchanged`: the source
       *  is returned as is (the formatter could not preserve its meaning). */
      order: 'grouped' | 'original' | 'unchanged'
    }
  | { ok: false; errors: ParseError[] }

const INDENT = '  '

/** One output line; `blank` = preceded by (exactly) one blank line. */
interface Line {
  text: string
  blank: boolean
}

/** Something that starts its own output line: a statement, a block item, or
 *  a multi-line block's closing `}`. */
interface Element {
  leading: Line[]
  head: string
  blank: boolean
  trailing?: string
  /** A block laid out over several lines (an inline block is part of `head`). */
  block?: { openTrailing?: string; items: Element[]; close: Element }
}

interface Unit {
  kind: 'decl' | 'edge'
  element: Element
}

interface Mark {
  start: number
  /** Exclusive. */
  end: number
  token?: Token
  comment?: string
}

export function formatD2(source: string): FormatResult {
  const parsed = parse(source)
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const before = meaningOf(source)
  for (const order of ['grouped', 'original'] as const) {
    let text: string
    try {
      text = render(source, order === 'grouped')
    } catch {
      continue
    }
    if (sameMeaning(before, meaningOf(text), order === 'grouped')) return { ok: true, text, order }
  }
  return { ok: true, text: source, order: 'unchanged' }
}

// -- layout model --------------------------------------------------------------

function render(source: string, grouped: boolean): string {
  const { tokens } = tokenize(source)
  const program = parseTokens(tokens)
  if (program.kind !== 'complete') throw new Error('not a complete program')

  const lineOf = lineIndex(source)
  const marks = collectMarks(source, tokens)
  const blankBefore = (i: number): boolean =>
    i > 0 && lineOf(marks[i]!.start) - lineOf(marks[i - 1]!.end - 1) >= 2

  // Where each element starts / ends, to hand comments to their owner.
  const startsAt = new Map<Token, Element>()
  const endsAt = new Map<Token, (comment: string) => void>()
  const markIndex = new Map<Token, number>()
  marks.forEach((m, i) => {
    if (m.token) markIndex.set(m.token, i)
  })
  const blankAt = (tok: Token): boolean => blankBefore(markIndex.get(tok)!)

  const element = (first: Token, head: string): Element => {
    const el: Element = { leading: [], head, blank: blankAt(first) }
    startsAt.set(first, el)
    return el
  }

  const units: Unit[] = program.statements.map((stmt) => {
    const first = stmt.kind === 'edge' ? stmt.source : stmt.id
    const head = statementHead(stmt)
    const block = stmt.block as BlockSyntax<BlockItemSyntax> | undefined
    const inline = !block || lineOf(block.open.startOffset) === lineOf(block.close.startOffset)
    const el = element(first, inline && block ? `${head} ${inlineBlock(block)}` : head)
    if (!block || inline) {
      endsAt.set(lastToken(stmt), (c) => {
        el.trailing = c
      })
    } else {
      const items = block.items.map((item) => {
        const itemEl = element(firstOfItem(item), itemText(item))
        endsAt.set(lastOfItem(item), (c) => {
          itemEl.trailing = c
        })
        return itemEl
      })
      const close = element(block.close, '}')
      endsAt.set(block.close, (c) => {
        close.trailing = c
      })
      const multi: NonNullable<Element['block']> = { items, close }
      endsAt.set(block.open, (c) => {
        multi.openTrailing = c
      })
      el.block = multi
    }
    return { kind: stmt.kind === 'edge' ? 'edge' : 'decl', element: el }
  })

  // Hand out the comments.
  let pending: Line[] = []
  let lastCode: Token | undefined
  marks.forEach((m, i) => {
    if (m.comment !== undefined) {
      const prev = marks[i - 1]
      const sameLine = prev?.token && lineOf(prev.end - 1) === lineOf(m.start)
      if (sameLine && lastCode) {
        const owner = endsAt.get(lastCode)
        if (!owner) throw new Error('trailing comment without an owner')
        owner(m.comment)
      } else {
        pending.push({ text: m.comment, blank: blankBefore(i) })
      }
      return
    }
    const tok = m.token!
    if (tok.kind === 'Semicolon') return
    lastCode = tok
    const el = startsAt.get(tok)
    if (el) {
      el.leading = pending
      pending = []
    } else if (pending.length > 0) {
      throw new Error('comment before a mid-line token')
    }
  })
  const footer = pending

  // Comments above the first statement, up to its last blank line, are the
  // file header and stay at the top whatever comes first.
  let header: Line[] = []
  const firstUnit = units[0]?.element
  if (firstUnit) {
    const blanks = [...firstUnit.leading.map((l) => l.blank), firstUnit.blank]
    const cut = blanks.lastIndexOf(true)
    if (cut > 0) {
      header = firstUnit.leading.slice(0, cut)
      firstUnit.leading = firstUnit.leading.slice(cut)
    }
  }

  const ordered = grouped
    ? [...units.filter((u) => u.kind === 'decl'), ...units.filter((u) => u.kind === 'edge')]
    : units

  const out: Line[] = header
  let sawDecl = false
  let afterHeader = header.length > 0
  for (const unit of ordered) {
    const lines = renderElement(unit.element, '')
    const first = lines[0]!
    const firstEdge = grouped && unit.kind === 'edge' && sawDecl
    if (out.length === 0) first.blank = false
    else if (afterHeader || firstEdge) first.blank = true
    afterHeader = false
    sawDecl = unit.kind === 'decl'
    out.push(...lines)
  }
  footer.forEach((l, i) => {
    if (i === 0 && out.length === 0) l.blank = false
    out.push(l)
  })

  if (out.length === 0) return ''
  return `${out.map((l) => (l.blank ? `\n${l.text}` : l.text)).join('\n')}\n`
}

function renderElement(el: Element, indent: string): Line[] {
  const withComment = (text: string, comment: string | undefined) =>
    comment === undefined ? text : `${text} ${comment}`
  const lines: Line[] = el.leading.map((l) => ({ text: indent + l.text, blank: l.blank }))
  if (!el.block) {
    lines.push({ text: withComment(indent + el.head, el.trailing), blank: el.blank })
    return lines
  }
  const { openTrailing, items, close } = el.block
  lines.push({ text: withComment(`${indent}${el.head} {`, openTrailing), blank: el.blank })
  const inner = indent + INDENT
  const body: Line[] = items.flatMap((item) => renderElement(item, inner))
  body.push(...close.leading.map((l) => ({ text: inner + l.text, blank: l.blank })))
  if (body[0]) body[0].blank = false
  lines.push(...body)
  lines.push({ text: withComment(`${indent}}`, close.trailing), blank: false })
  return lines
}

// -- statement text ------------------------------------------------------------

function labelText(label: LabelSyntax): string {
  return label.tokens.map((t) => t.image).join(' ')
}

function statementHead(stmt: StatementSyntax): string {
  const head =
    stmt.kind === 'edge'
      ? `${stmt.source.image} ${stmt.arrow.image} ${stmt.target.image}`
      : stmt.id.image
  return stmt.label ? `${head}: ${labelText(stmt.label)}` : head
}

function attrText(attr: AttrSyntax): string {
  return `${attr.path.map((t) => t.image).join('.')}: ${attr.value.image}`
}

function itemText(item: BlockItemSyntax): string {
  return item.kind === 'attr' ? attrText(item) : item.id.image
}

function inlineBlock(block: BlockSyntax<BlockItemSyntax>): string {
  return block.items.length === 0 ? '{}' : `{ ${block.items.map(itemText).join('; ')} }`
}

function firstOfItem(item: BlockItemSyntax): Token {
  return item.kind === 'attr' ? item.path[0] : item.id
}

function lastOfItem(item: BlockItemSyntax): Token {
  return item.kind === 'attr' ? item.value : item.id
}

function lastToken(stmt: StatementSyntax): Token {
  if (stmt.block) return stmt.block.close
  if (stmt.label) return stmt.label.tokens[stmt.label.tokens.length - 1]!
  return stmt.kind === 'edge' ? stmt.target : stmt.id
}

// -- source scanning -----------------------------------------------------------

/** Tokens (newlines aside) and comments, in source order. Comments live in the
 *  gaps between tokens — whitespace and comments are all a gap can hold. */
function collectMarks(source: string, tokens: Token[]): Mark[] {
  const marks: Mark[] = []
  const comments = (from: number, to: number) => {
    const gap = source.slice(from, to)
    for (const m of gap.matchAll(/#[^\n]*/g)) {
      const start = from + m.index
      marks.push({ start, end: start + m[0].length, comment: m[0].trimEnd() })
    }
  }
  let pos = 0
  for (const tok of tokens) {
    comments(pos, tok.startOffset)
    pos = tok.endOffset + 1
    if (tok.kind !== 'Newline') marks.push({ start: tok.startOffset, end: pos, token: tok })
  }
  comments(pos, source.length)
  return marks
}

/** 0-based line of an offset, counting `\n` (the parser's statement break). */
function lineIndex(source: string): (offset: number) => number {
  const breaks: number[] = []
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) breaks.push(i)
  return (offset) => {
    let lo = 0
    let hi = breaks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (breaks[mid]! < offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

// -- meaning -------------------------------------------------------------------

/** What a formatting pass must preserve: the diagram (source ranges aside),
 *  every statement's tokens (attributes the builder ignores included), and
 *  every comment. */
export interface Meaning {
  diagram: string
  decls: string[]
  edges: string[]
  statements: string[]
  comments: string[]
}

export function meaningOf(source: string): Meaning | null {
  const parsed = parse(source)
  if (!parsed.ok) return null
  const { tokens } = tokenize(source)
  const program = parseTokens(tokens)
  if (program.kind !== 'complete') return null
  const statements = program.statements.map((s) => statementTokens(s))
  const comments = collectMarks(source, tokens)
    .flatMap((m) => (m.comment === undefined ? [] : [m.comment]))
    .sort()
  return {
    diagram: JSON.stringify(stripRanges(parsed.diagram)),
    decls: statements.filter((s) => !s.edge).map((s) => s.text),
    edges: statements.filter((s) => s.edge).map((s) => s.text),
    statements: statements.map((s) => s.text),
    comments,
  }
}

function sameMeaning(a: Meaning | null, b: Meaning | null, regrouped: boolean): boolean {
  if (!a || !b) return false
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
  return (
    a.diagram === b.diagram &&
    eq(a.decls, b.decls) &&
    eq(a.edges, b.edges) &&
    (regrouped || eq(a.statements, b.statements)) &&
    eq(a.comments, b.comments)
  )
}

function statementTokens(stmt: StatementSyntax): { edge: boolean; text: string } {
  const parts: string[] =
    stmt.kind === 'edge'
      ? [stmt.source.image, stmt.arrow.image, stmt.target.image]
      : [stmt.id.image]
  if (stmt.label) parts.push(':', ...stmt.label.tokens.map((t) => t.image))
  if (stmt.block) {
    parts.push('{')
    for (const item of stmt.block.items as BlockItemSyntax[]) {
      parts.push(item.kind === 'attr' ? attrText(item) : item.id.image, ';')
    }
    parts.push('}')
  }
  return { edge: stmt.kind === 'edge', text: parts.join(' ') }
}

/** The diagram without source positions. */
export function stripRanges(diagram: Diagram): unknown {
  const drop = new Set(['range', 'idRange', 'labelRange', 'memberRanges'])
  return JSON.parse(JSON.stringify(diagram, (k, v) => (drop.has(k) ? undefined : v)))
}
