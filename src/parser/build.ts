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
import type {
  AttrSyntax,
  EdgeSyntax,
  LabelSyntax,
  MemberSyntax,
  NodeOrAreaSyntax,
  StatementSyntax,
} from './parser'

interface BlockItemResult {
  kind: 'attr' | 'member'
  // For attrs: dotted path segments (e.g. ['style', 'stroke-dash']).
  // For members: the single member id.
  path: string[]
  // attrs only.
  value?: AttrValue
  range: SourceRange
}

interface AttrValue {
  kind: 'string' | 'identifier' | 'number'
  text: string
  raw: string
}

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
  const seenIds = new Set<string>()

  for (const stmt of statements) {
    if (stmt.kind === 'edge') {
      diagram.edges.push(edgeDecl(stmt, errors))
      continue
    }

    const result = nodeOrAreaDecl(stmt, errors)
    // Node or area: enforce id uniqueness.
    if (seenIds.has(result.id)) {
      errors.push({
        message: `Duplicate id "${result.id}".`,
        range: result.range,
      })
      continue
    }
    seenIds.add(result.id)

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
        errors.push({
          message: `Area "${area.id}" cannot contain itself.`,
          range,
        })
        return
      }
      const child = areaById.get(mid)
      if (!child) return // node (or dangling) member — nothing to check
      if (state.get(mid) === 1) {
        errors.push({
          message: `Membership cycle: area "${area.id}" contains "${mid}", which already contains "${area.id}".`,
          range,
        })
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
  const items = stmt.block?.items.map(blockItem) ?? []
  const endTok = stmt.block?.close ?? (stmt.label ? lastOf(stmt.label.tokens) : stmt.id)
  const range = makeRange(stmt.id, endTok)

  // No body at all: treat as a bare node declaration with default shape.
  if (!stmt.block) {
    return makeNode(id, label, 'rectangle', range, idRange, labelRange)
  }

  const hasMembers = items.some((i) => i.kind === 'member')
  const hasAttrs = items.some((i) => i.kind === 'attr')

  if (hasMembers) {
    // Members + attrs in the same block aren't part of the subset.
    if (hasAttrs) {
      errors.push({
        message: `Container "${id}" mixes attributes and members; only one is allowed in an area.`,
        range,
      })
    }
    return buildArea(id, label, items, range, errors)
  }

  return buildNode(id, label, items, range, idRange, labelRange, errors)
}

function buildNode(
  id: string,
  label: string | undefined,
  items: BlockItemResult[],
  range: SourceRange,
  idRange: SourceRange,
  labelRange: SourceRange | undefined,
  errors: ParseError[],
): NodeDecl {
  let shape: ShapeName = 'rectangle'
  for (const item of items) {
    if (item.kind !== 'attr') continue
    if (item.path.length === 1 && item.path[0] === 'shape') {
      const value = item.value?.text
      if (value && (SHAPE_NAMES as readonly string[]).includes(value)) {
        shape = value as ShapeName
      } else {
        errors.push({
          message: `Unknown shape "${value ?? ''}" on node "${id}".`,
          range: item.range,
        })
      }
      continue
    }
    // Unknown attribute on a node — silently ignored for forward-compat,
    // except dotted paths longer than 2 which we explicitly reject.
    if (item.path.length > 2) {
      errors.push({
        message: `Unsupported dotted attribute "${item.path.join('.')}" on node "${id}".`,
        range: item.range,
      })
    }
  }
  return makeNode(id, label, shape, range, idRange, labelRange)
}

function buildArea(
  id: string,
  label: string | undefined,
  items: BlockItemResult[],
  range: SourceRange,
  errors: ParseError[],
): AreaDecl {
  const members: string[] = []
  const memberRanges: SourceRange[] = []
  for (const item of items) {
    if (item.kind !== 'member') continue
    const memberId = item.path[0]!
    if (members.includes(memberId)) {
      errors.push({
        message: `Area "${id}" lists member "${memberId}" more than once.`,
        range: item.range,
      })
      continue
    }
    members.push(memberId)
    memberRanges.push(item.range)
  }
  return { kind: 'area', id, label, members, memberRanges, range }
}

// -- edge -------------------------------------------------------------------

function edgeDecl(stmt: EdgeSyntax, errors: ParseError[]): EdgeDecl {
  const label = stmt.label ? labelText(stmt.label) : undefined

  let style: EdgeStyle = 'solid'
  for (const a of stmt.block?.items ?? []) {
    const item = attr(a)
    if (item.path.length === 2 && item.path[0] === 'style' && item.path[1] === 'stroke-dash') {
      style = strokeDashToStyle(item.value)
      continue
    }
    if (item.path.length > 2) {
      errors.push({
        message: `Unsupported dotted attribute "${item.path.join('.')}" on edge.`,
        range: item.range,
      })
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

function blockItem(item: AttrSyntax | MemberSyntax): BlockItemResult {
  if (item.kind === 'attr') return attr(item)
  return {
    kind: 'member',
    path: [item.id.image],
    range: makeRange(item.id, item.id),
  }
}

function attr(item: AttrSyntax): BlockItemResult {
  const path = item.path.map((t) => t.image)
  const range = makeRange(item.path[0]!, item.value)
  return { kind: 'attr', path, value: attrValue(item.value), range }
}

function attrValue(tok: Token): AttrValue {
  if (tok.kind === 'StringLit') return { kind: 'string', text: unquote(tok.image), raw: tok.image }
  if (tok.kind === 'NumberLit') return { kind: 'number', text: tok.image, raw: tok.image }
  return { kind: 'identifier', text: tok.image, raw: tok.image }
}

// Unquoted labels may span multiple identifier tokens; join with spaces.
function labelText(label: LabelSyntax): string {
  if (label.quoted) return unquote(label.tokens[0]!.image)
  return label.tokens.map((t) => t.image).join(' ')
}

// Source span covering the label value: the StringLit (quotes included) or
// the run of unquoted identifier tokens. Used to rewrite a node's label in
// place from the canvas editor.
function labelValueRange(label: LabelSyntax): SourceRange {
  return makeRange(label.tokens[0]!, lastOf(label.tokens))
}

// --- pure helpers ----------------------------------------------------------

function lastOf(tokens: Token[]): Token {
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

function strokeDashToStyle(value: AttrValue | undefined): EdgeStyle {
  if (!value) return 'solid'
  const n = Number(value.text)
  if (!Number.isFinite(n) || n <= 0) return 'solid'
  // Map dash length to two visual styles: short dashes (1-3) render as dotted,
  // longer dashes (>3) render as dashed.
  if (n <= 3) return 'dotted'
  return 'dashed'
}
