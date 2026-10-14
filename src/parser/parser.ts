// Recursive-descent parser for the D2 subset.
//
// Grammar (informal):
//   program        := Newline* (statement Newline*)*
//   statement      := edgeDecl | nodeOrAreaDecl
//   nodeOrAreaDecl := Identifier (Colon labelOrValue)? (LCurly Newline* (blockItem (Semicolon | Newline)*)* RCurly)?
//   blockItem      := attr | memberStmt
//   attr           := Identifier (Dot Identifier)* Colon attrValue
//   memberStmt     := Identifier
//   edgeDecl       := Identifier arrowOp Identifier (Colon labelOrValue)? (LCurly Newline* (attr (Semicolon | Newline)*)* RCurly)?
//   arrowOp        := ArrowRight | ArrowLeft | ArrowBoth | DashDash
//   labelOrValue   := StringLit | Identifier+
//   attrValue      := StringLit | Identifier | NumberLit
//
// The grammar is intentionally permissive about node-vs-area; the builder
// disambiguates by inspecting the block items it collected.
//
// The first syntax error stops the parse (there is no error recovery). Input
// left over after the last statement is reported but still yields the
// statements parsed so far, so their semantic errors surface too. Error
// wording lives in `./messages`.

import type { Token, TokenKind } from './lexer'
import {
  expectedAttrColon,
  expectedAttrName,
  expectedAttrValue,
  expectedLabel,
  expectedStatement,
  expectedTarget,
  isArrow,
  type StatementEnd,
  unclosedBlock,
  unexpectedAfter,
} from './messages'

/** One or more tokens. */
export type Tokens = [Token, ...Token[]]

/** The StringLit, or the run of unquoted identifiers (`api: Web App`). */
export type LabelSyntax = { quoted: true; tokens: [Token] } | { quoted: false; tokens: Tokens }

export interface AttrSyntax {
  kind: 'attr'
  /** Dotted path segments (`style` `.` `stroke-dash`). */
  path: Tokens
  value: Token
}

export interface MemberSyntax {
  kind: 'member'
  id: Token
}

export type BlockItemSyntax = AttrSyntax | MemberSyntax

export interface BlockSyntax<Item> {
  open: Token
  close: Token
  items: Item[]
}

export interface NodeOrAreaSyntax {
  kind: 'nodeOrArea'
  id: Token
  label?: LabelSyntax
  block?: BlockSyntax<BlockItemSyntax>
}

export interface EdgeSyntax {
  kind: 'edge'
  source: Token
  arrow: Token
  target: Token
  label?: LabelSyntax
  block?: BlockSyntax<AttrSyntax>
}

export type StatementSyntax = NodeOrAreaSyntax | EdgeSyntax

export interface SyntaxIssue {
  message: string
  /** The offending token; absent when the parser ran out of input. */
  token?: Token
}

export type ProgramSyntax =
  | { kind: 'complete'; statements: StatementSyntax[] }
  /** Input left over after the last statement: the statements before it are
   *  whole and still build. */
  | { kind: 'partial'; statements: StatementSyntax[]; error: SyntaxIssue }
  /** A statement broke off midway; nothing builds. */
  | { kind: 'failed'; error: SyntaxIssue }

class Failure {
  constructor(readonly error: SyntaxIssue) {}
}

const imageOf = (tokens: Token[]): string => tokens.map((t) => t.image).join('.')

/** How a complete statement ends, which shapes the message for whatever
 *  unexpectedly follows it on the same line. */
const endOf = (stmt: StatementSyntax): StatementEnd => {
  if (stmt.block) return 'other'
  if (stmt.label) return stmt.label.quoted ? 'other' : 'unquotedLabel'
  return stmt.kind === 'edge' ? 'edgeTarget' : 'id'
}

export function parseTokens(tokens: Token[]): ProgramSyntax {
  let pos = 0

  const peek = (ahead = 0): Token | undefined => tokens[pos + ahead]
  const is = (kind: TokenKind, ahead = 0): boolean => peek(ahead)?.kind === kind

  /** Stop the parse at the next token (none at the end of input). */
  const fail = (message: (next: Token | undefined) => string): never => {
    const token = peek()
    throw new Failure({ message: message(token), token })
  }

  /** Take the next token, which must be `kind`, or fail with `message(next)`. */
  const consume = (kind: TokenKind, message: (next: Token | undefined) => string): Token => {
    if (!is(kind)) fail(message)
    return tokens[pos++]!
  }

  /** Take the next token, known to be there (the caller peeked it). */
  const take = (): Token => tokens[pos++]!

  const skip = (...kinds: TokenKind[]): void => {
    while (kinds.some((k) => is(k))) pos++
  }

  // labelOrValue := StringLit | Identifier+
  //
  // Unquoted labels may contain spaces (e.g. `api: Web App`), so we greedily
  // consume consecutive identifiers up to the next structural token. `head`
  // names the statement for the error message (`api`, `a -> b`).
  const labelOrValue = (head: string): LabelSyntax => {
    if (is('StringLit')) return { quoted: true, tokens: [take()] }
    if (!is('Identifier')) fail((next) => expectedLabel(head, next))
    const ids: Tokens = [take()]
    while (is('Identifier')) ids.push(take())
    return { quoted: false, tokens: ids }
  }

  // attrValue := StringLit | Identifier | NumberLit
  const attrValue = (path: string): Token => {
    if (!is('StringLit') && !is('Identifier') && !is('NumberLit')) {
      fail((next) => expectedAttrValue(path, next))
    }
    return take()
  }

  // attr := Identifier (Dot Identifier)* Colon attrValue — always entered on
  // an Identifier.
  const attr = (inEdgeBlock: boolean): AttrSyntax => {
    const path: Tokens = [take()]
    while (is('Dot')) {
      take()
      path.push(consume('Identifier', (next) => expectedAttrName(imageOf(path), next)))
    }
    const name = imageOf(path)
    consume('Colon', (next) => expectedAttrColon(name, next, inEdgeBlock))
    return { kind: 'attr', path, value: attrValue(name) }
  }

  // `{` Newline* (item (`;` | Newline)*)* `}` — items are terminated by `;` or
  // newline; both are optional before `}` so a trailing item works. Always
  // entered on an LCurly. `owner` names the block for the error message.
  const block = <Item>(
    owner: string,
    ownsMembers: boolean,
    item: () => Item,
  ): BlockSyntax<Item> => {
    const open = take()
    skip('Newline')
    const items: Item[] = []
    while (is('Identifier')) {
      items.push(item())
      skip('Semicolon', 'Newline')
    }
    const close = consume('RCurly', (next) => unclosedBlock(owner, ownsMembers, next))
    return { open, items, close }
  }

  // blockItem := attr | memberStmt
  //
  // We distinguish on the second token: `Identifier Colon` or `Identifier Dot`
  // is an attr; `Identifier` followed by anything else (`;`, newline, `}`) is
  // a member declaration.
  const blockItem = (): BlockItemSyntax =>
    is('Colon', 1) || is('Dot', 1) ? attr(false) : { kind: 'member', id: take() }

  const optionalLabel = (head: string): LabelSyntax | undefined => {
    if (!is('Colon')) return undefined
    take()
    return labelOrValue(head)
  }

  // nodeOrAreaDecl := Identifier (Colon labelOrValue)? block?
  const nodeOrAreaDecl = (): NodeOrAreaSyntax => {
    const id = take()
    const label = optionalLabel(id.image)
    const body = is('LCurly') ? block(id.image, true, blockItem) : undefined
    return { kind: 'nodeOrArea', id, label, block: body }
  }

  // edgeDecl := Identifier arrowOp Identifier (Colon labelOrValue)? block?
  // Entered on `Identifier arrowOp`.
  const edgeDecl = (): EdgeSyntax => {
    const source = take()
    const arrow = take()
    const target = consume('Identifier', (next) => expectedTarget(arrow, next))
    const head = `${source.image} ${arrow.image} ${target.image}`
    const label = optionalLabel(head)
    const body = is('LCurly') ? block(head, false, () => attr(true)) : undefined
    return { kind: 'edge', source, arrow, target, label, block: body }
  }

  // statement := edgeDecl | nodeOrAreaDecl — an arrow after the first
  // identifier means an edge.
  const statement = (): StatementSyntax => (isArrow(peek(1)) ? edgeDecl() : nodeOrAreaDecl())

  // program := Newline* (statement Newline*)*
  try {
    const statements: StatementSyntax[] = []
    skip('Newline')
    while (is('Identifier')) {
      statements.push(statement())
      skip('Newline')
    }
    const rest = peek()
    if (!rest) return { kind: 'complete', statements }
    // A statement ends at a newline: `rest` either starts a line (it can't
    // start a statement) or trails the last statement on its line.
    const last = statements[statements.length - 1]
    const trailing = last !== undefined && tokens[pos - 1]?.kind !== 'Newline'
    const message = trailing ? unexpectedAfter(rest, endOf(last)) : expectedStatement(rest)
    return { kind: 'partial', statements, error: { message, token: rest } }
  } catch (e) {
    if (e instanceof Failure) return { kind: 'failed', error: e.error }
    throw e
  }
}
