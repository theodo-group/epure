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
// statements parsed so far, so their semantic errors surface too.

import type { Token, TokenKind } from './lexer'

export interface LabelSyntax {
  /** The StringLit, or the run of unquoted identifiers (`api: Web App`). */
  tokens: Token[]
  quoted: boolean
}

export interface AttrSyntax {
  kind: 'attr'
  /** Dotted path segments (`style` `.` `stroke-dash`). */
  path: Token[]
  value: Token
}

export interface MemberSyntax {
  kind: 'member'
  id: Token
}

export interface BlockSyntax<Item> {
  open: Token
  close: Token
  items: Item[]
}

export interface NodeOrAreaSyntax {
  kind: 'nodeOrArea'
  id: Token
  label?: LabelSyntax
  block?: BlockSyntax<AttrSyntax | MemberSyntax>
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

export interface ProgramSyntax {
  /** Absent when a syntax error stopped the parse. */
  statements?: StatementSyntax[]
  error?: SyntaxIssue
}

const ARROWS: readonly TokenKind[] = ['ArrowRight', 'ArrowLeft', 'ArrowBoth', 'DashDash']

class Failure {
  constructor(readonly error: SyntaxIssue) {}
}

const foundImage = (token: Token | undefined): string => token?.image ?? ''

export function parseTokens(tokens: Token[]): ProgramSyntax {
  let pos = 0

  const peek = (ahead = 0): Token | undefined => tokens[pos + ahead]
  const is = (kind: TokenKind, ahead = 0): boolean => peek(ahead)?.kind === kind

  const consume = (kind: TokenKind): Token => {
    const token = peek()
    if (token?.kind !== kind) {
      throw new Failure({
        message: `Expecting token of type --> ${kind} <-- but found --> '${foundImage(token)}' <--`,
        token,
      })
    }
    pos++
    return token
  }

  /** No alternative fits the next token; each entry is one accepted kind. */
  const noViableAlt = (kinds: TokenKind[]): Failure => {
    const token = peek()
    const options = kinds.map((k, i) => `  ${i + 1}. [${k}]`).join('\n')
    return new Failure({
      message: `Expecting: one of these possible Token sequences:\n${options}\nbut found: '${foundImage(token)}'`,
      token,
    })
  }

  const skip = (...kinds: TokenKind[]): void => {
    while (kinds.some((k) => is(k))) pos++
  }

  // labelOrValue := StringLit | Identifier+
  //
  // Unquoted labels may contain spaces (e.g. `api: Web App`), so we greedily
  // consume consecutive identifiers up to the next structural token.
  const labelOrValue = (): LabelSyntax => {
    if (is('StringLit')) return { tokens: [consume('StringLit')], quoted: true }
    if (!is('Identifier')) throw noViableAlt(['StringLit', 'Identifier'])
    const ids = [consume('Identifier')]
    while (is('Identifier')) ids.push(consume('Identifier'))
    return { tokens: ids, quoted: false }
  }

  // attrValue := StringLit | Identifier | NumberLit
  const attrValue = (): Token => {
    for (const kind of ['StringLit', 'Identifier', 'NumberLit'] as const) {
      if (is(kind)) return consume(kind)
    }
    throw noViableAlt(['StringLit', 'Identifier', 'NumberLit'])
  }

  // attr := Identifier (Dot Identifier)* Colon attrValue
  const attr = (): AttrSyntax => {
    const path = [consume('Identifier')]
    while (is('Dot')) {
      consume('Dot')
      path.push(consume('Identifier'))
    }
    consume('Colon')
    return { kind: 'attr', path, value: attrValue() }
  }

  // `{` Newline* (item (`;` | Newline)*)* `}` — items are terminated by `;` or
  // newline; both are optional before `}` so a trailing item works.
  const block = <Item>(item: () => Item): BlockSyntax<Item> => {
    const open = consume('LCurly')
    skip('Newline')
    const items: Item[] = []
    while (is('Identifier')) {
      items.push(item())
      skip('Semicolon', 'Newline')
    }
    return { open, items, close: consume('RCurly') }
  }

  // blockItem := attr | memberStmt
  //
  // We distinguish on the second token: `Identifier Colon` or `Identifier Dot`
  // is an attr; `Identifier` followed by anything else (`;`, newline, `}`) is
  // a member declaration.
  const blockItem = (): AttrSyntax | MemberSyntax =>
    is('Colon', 1) || is('Dot', 1) ? attr() : { kind: 'member', id: consume('Identifier') }

  const optionalLabel = (): LabelSyntax | undefined => {
    if (!is('Colon')) return undefined
    consume('Colon')
    return labelOrValue()
  }

  // nodeOrAreaDecl := Identifier (Colon labelOrValue)? block?
  const nodeOrAreaDecl = (): NodeOrAreaSyntax => {
    const id = consume('Identifier')
    const label = optionalLabel()
    const body = is('LCurly') ? block(blockItem) : undefined
    return { kind: 'nodeOrArea', id, label, block: body }
  }

  // edgeDecl := Identifier arrowOp Identifier (Colon labelOrValue)? block?
  const edgeDecl = (): EdgeSyntax => {
    const source = consume('Identifier')
    const arrow = consume(peek()!.kind)
    const target = consume('Identifier')
    const label = optionalLabel()
    const body = is('LCurly') ? block(attr) : undefined
    return { kind: 'edge', source, arrow, target, label, block: body }
  }

  // statement := edgeDecl | nodeOrAreaDecl — an arrow after the first
  // identifier means an edge.
  const statement = (): StatementSyntax => {
    const next = peek(1)
    return next && ARROWS.includes(next.kind) ? edgeDecl() : nodeOrAreaDecl()
  }

  // program := Newline* (statement Newline*)*
  try {
    const statements: StatementSyntax[] = []
    skip('Newline')
    while (is('Identifier')) {
      statements.push(statement())
      skip('Newline')
    }
    const rest = peek()
    if (rest) {
      return {
        statements,
        error: { message: `Redundant input, expecting EOF but found: ${rest.image}`, token: rest },
      }
    }
    return { statements }
  } catch (e) {
    if (e instanceof Failure) return { error: e.error }
    throw e
  }
}
