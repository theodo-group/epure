// Syntax tree -> AST.
//
// The syntax tree comes from `parseTokens`; we walk it and build the typed
// `Diagram` shape declared in `./ast`. The builder also runs the semantic
// validations the grammar can't enforce (duplicate ids, unknown shapes,
// restricted dotted paths, area self-membership and membership cycles).
//
// Containers nest BY REFERENCE: an area's member list may name another area's
// id (a literal nested block is still a grammar error). The only illegal
// member graphs are an area containing itself and a cycle between areas —
// both would make the derived boxes undefined.

import {
  type AreaDecl,
  type Diagram,
  type EdgeDecl,
  type EdgeDirection,
  type EdgeStyle,
  type NodeDecl,
  type ParseError,
  type ShapeName,
  type SourceRange,
  SHAPE_NAMES,
} from './ast'
import type { Token, TokenKind } from './lexer'
import {
  duplicateId,
  duplicateMember,
  membershipCycle,
  mixedBlock,
  selfMember,
  unknownShape,
  unsupportedDottedAttr,
} from './messages'
import type {
  AttrSyntax,
  EdgeSyntax,
  LabelSyntax,
  MemberSyntax,
  NodeOrAreaSyntax,
  StatementSyntax,
  Tokens,
} from './parser'

const DIRECTIONS: Partial<Record<TokenKind, EdgeDirection>> = {
  ArrowRight: 'forward',
  ArrowLeft: 'backward',
  ArrowBoth: 'bidirectional',
  DashDash: 'none',
}

export function buildDiagram(statements: StatementSyntax[]): {
  diagram: Diagram
  errors: ParseError[]
} {
  const errors: ParseError[] = []
  const diagram: Diagram = { nodes: [], edges: [], areas: [] }
  // Line of each node/area id's first declaration, quoted by the duplicate error.
  const seenIds = new Map<string, number>()

  for (const stmt of statements) {
    if (stmt.kind === 'edge') {
      diagram.edges.push(edgeDecl(stmt, errors))
      continue
    }

    const result = nodeOrAreaDecl(stmt, errors)
    // Node or area: enforce id uniqueness.
    const firstLine = seenIds.get(result.id)
    if (firstLine !== undefined) {
      errors.push({ message: duplicateId(result.id, firstLine), range: result.range })
      continue
    }
    seenIds.set(result.id, result.range.start.line)

    if (result.kind === 'node') {
      diagram.nodes.push(result)
    } else {
      diagram.areas.push(result)
    }
  }

  validateAreaNesting(diagram.areas, errors)

  return { diagram, errors }
}

// Nested containers are by-reference (an area listing another area's id as a
// member). The member graph must stay a DAG: an area containing itself or a
// cycle between areas would make the derived boxes undefined, so both are
// hard errors, anchored to the member token that closes the loop.
function validateAreaNesting(areas: AreaDecl[], errors: ParseError[]): void {
  const areaById = new Map(areas.map((a) => [a.id, a] as const))
  // 1 = on the current DFS stack, 2 = fully explored.
  const state = new Map<string, 1 | 2>()
  const visit = (area: AreaDecl): void => {
    state.set(area.id, 1)
    area.members.forEach((mid, i) => {
      const range = area.memberRanges[i] ?? area.range
      if (mid === area.id) {
        errors.push({ message: selfMember(area.id), range })
        return
      }
      const child = areaById.get(mid)
      if (!child) return // node (or dangling) member — nothing to check
      if (state.get(mid) === 1) {
        errors.push({ message: membershipCycle(area.id, mid), range })
        return
      }
      if (!state.has(mid)) visit(child)
    })
    state.set(area.id, 2)
  }
  for (const a of areas) {
    if (!state.has(a.id)) visit(a)
  }
}

// -- node / area ------------------------------------------------------------

function nodeOrAreaDecl(stmt: NodeOrAreaSyntax, errors: ParseError[]): NodeDecl | AreaDecl {
  const id = stmt.id.image
  const idRange = makeRange(stmt.id, stmt.id)
  const label = stmt.label ? labelText(stmt.label) : undefined
  const labelRange = stmt.label ? labelValueRange(stmt.label) : undefined
  const endTok = stmt.block?.close ?? (stmt.label ? lastOf(stmt.label.tokens) : stmt.id)
  const range = makeRange(stmt.id, endTok)

  // No body at all: treat as a bare node declaration with default shape.
  if (!stmt.block) {
    return makeNode(id, label, 'rectangle', range, idRange, labelRange)
  }

  const { items } = stmt.block
  const members = items.filter((i): i is MemberSyntax => i.kind === 'member')
  const attrs = items.filter((i): i is AttrSyntax => i.kind === 'attr')

  if (members.length > 0) {
    // Members + attrs in the same block aren't part of the subset.
    if (attrs.length > 0) errors.push({ message: mixedBlock(id), range })
    return buildArea(id, label, members, range, errors)
  }

  return buildNode(id, label, attrs, range, idRange, labelRange, errors)
}

function buildNode(
  id: string,
  label: string | undefined,
  attrs: AttrSyntax[],
  range: SourceRange,
  idRange: SourceRange,
  labelRange: SourceRange | undefined,
  errors: ParseError[],
): NodeDecl {
  let shape: ShapeName = 'rectangle'
  for (const attr of attrs) {
    const path = attrPath(attr)
    if (path.length === 1 && path[0] === 'shape') {
      const value = valueText(attr.value)
      if ((SHAPE_NAMES as readonly string[]).includes(value)) {
        shape = value as ShapeName
      } else {
        errors.push({ message: unknownShape(value, id), range: attrRange(attr) })
      }
      continue
    }
    // Unknown attribute on a node — silently ignored for forward-compat,
    // except dotted paths longer than 2 which we explicitly reject.
    if (path.length > 2) {
      errors.push({ message: unsupportedDottedAttr(path.join('.'), id), range: attrRange(attr) })
    }
  }
  return makeNode(id, label, shape, range, idRange, labelRange)
}

function buildArea(
  id: string,
  label: string | undefined,
  items: MemberSyntax[],
  range: SourceRange,
  errors: ParseError[],
): AreaDecl {
  const members: string[] = []
  const memberRanges: SourceRange[] = []
  for (const item of items) {
    const memberId = item.id.image
    const memberRange = makeRange(item.id, item.id)
    if (members.includes(memberId)) {
      errors.push({ message: duplicateMember(id, memberId), range: memberRange })
      continue
    }
    members.push(memberId)
    memberRanges.push(memberRange)
  }
  return { kind: 'area', id, label, members, memberRanges, range }
}

// -- edge -------------------------------------------------------------------

function edgeDecl(stmt: EdgeSyntax, errors: ParseError[]): EdgeDecl {
  const label = stmt.label ? labelText(stmt.label) : undefined

  let style: EdgeStyle = 'solid'
  for (const attr of stmt.block?.items ?? []) {
    const path = attrPath(attr)
    if (path.length === 2 && path[0] === 'style' && path[1] === 'stroke-dash') {
      style = strokeDashToStyle(valueText(attr.value))
      continue
    }
    if (path.length > 2) {
      const edge = `${stmt.source.image} ${stmt.arrow.image} ${stmt.target.image}`
      errors.push({ message: unsupportedDottedAttr(path.join('.'), edge), range: attrRange(attr) })
    }
  }

  const endTok = stmt.block?.close ?? (stmt.label ? lastOf(stmt.label.tokens) : stmt.target)
  const range = makeRange(stmt.source, endTok)

  return {
    kind: 'edge',
    source: stmt.source.image,
    target: stmt.target.image,
    direction: DIRECTIONS[stmt.arrow.kind] ?? 'none',
    label,
    style,
    range,
  }
}

// -- block bodies -----------------------------------------------------------

/** Dotted path segments, e.g. `['style', 'stroke-dash']`. */
function attrPath(attr: AttrSyntax): string[] {
  return attr.path.map((t) => t.image)
}

/** From the first path segment through the value. */
function attrRange(attr: AttrSyntax): SourceRange {
  return makeRange(attr.path[0], attr.value)
}

/** An attribute value as text: a string literal unquoted, anything else as written. */
function valueText(tok: Token): string {
  return tok.kind === 'StringLit' ? unquote(tok.image) : tok.image
}

// Unquoted labels may span multiple identifier tokens; join with spaces.
function labelText(label: LabelSyntax): string {
  if (label.quoted) return unquote(label.tokens[0].image)
  return label.tokens.map((t) => t.image).join(' ')
}

// Source span covering the label value: the StringLit (quotes included) or
// the run of unquoted identifier tokens. Used to rewrite a node's label in
// place from the canvas editor.
function labelValueRange(label: LabelSyntax): SourceRange {
  return makeRange(label.tokens[0], lastOf(label.tokens))
}

// --- pure helpers ----------------------------------------------------------

function lastOf(tokens: Tokens): Token {
  return tokens[tokens.length - 1]!
}

function makeNode(
  id: string,
  label: string | undefined,
  shape: ShapeName,
  range: SourceRange,
  idRange: SourceRange,
  labelRange: SourceRange | undefined,
): NodeDecl {
  return {
    kind: 'node',
    id,
    label,
    shape,
    range,
    idRange,
    ...(labelRange ? { labelRange } : {}),
  }
}

function makeRange(start: Token, end: Token): SourceRange {
  return {
    start: { line: start.startLine, column: start.startColumn, offset: start.startOffset },
    end: { line: end.endLine, column: end.endColumn + 1, offset: end.endOffset + 1 },
  }
}

function unquote(raw: string): string {
  // Strip surrounding quote and unescape `\\`, `\"`, `\'`, `\n`, `\t`.
  const body = raw.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c !== '\\' || i === body.length - 1) {
      out += c
      continue
    }
    const next = body[++i]!
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      default:
        out += next
    }
  }
  return out
}

function strokeDashToStyle(value: string): EdgeStyle {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 'solid'
  // Map dash length to two visual styles: short dashes (1-3) render as dotted,
  // longer dashes (>3) render as dashed.
  if (n <= 3) return 'dotted'
  return 'dashed'
}
