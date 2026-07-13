// CST -> AST visitor.
//
// The CST nodes are produced by D2Parser; we walk them and build the typed
// `Diagram` shape declared in `./ast`. The visitor also runs the semantic
// validations the grammar can't enforce (duplicate ids, nested containers,
// unknown shapes, restricted dotted paths).

import type { CstNode, IToken } from 'chevrotain'

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
import { parserInstance } from './parser'

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor()

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

interface BlockResult {
  items: BlockItemResult[]
  range: SourceRange
}

interface LabelOrValueResult {
  text: string
  kind: 'string' | 'identifier'
}

export class D2Visitor extends BaseVisitor {
  errors: ParseError[] = []

  constructor() {
    super()
    // Skip Chevrotain's runtime check (would throw on missing rules).
    this.validateVisitor()
  }

  // -- root ---------------------------------------------------------------

  program(ctx: { statement?: CstNode[] }): Diagram {
    const diagram: Diagram = { nodes: [], edges: [], areas: [] }
    const seenIds = new Set<string>()

    for (const stmt of ctx.statement ?? []) {
      const result = this.visit(stmt) as
        | NodeDecl
        | AreaDecl
        | EdgeDecl
        | undefined
      if (!result) continue

      if (result.kind === 'edge') {
        diagram.edges.push(result)
        continue
      }

      // Node or area: enforce id uniqueness.
      if (seenIds.has(result.id)) {
        this.errors.push({
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

    return diagram
  }

  statement(ctx: {
    nodeOrAreaDecl?: CstNode[]
    edgeDecl?: CstNode[]
  }): NodeDecl | AreaDecl | EdgeDecl | undefined {
    if (ctx.edgeDecl) return this.visit(ctx.edgeDecl) as EdgeDecl
    if (ctx.nodeOrAreaDecl) {
      return this.visit(ctx.nodeOrAreaDecl) as NodeDecl | AreaDecl
    }
    return undefined
  }

  // -- node / area --------------------------------------------------------

  nodeOrAreaDecl(ctx: {
    Identifier: IToken[]
    Colon?: IToken[]
    labelOrValue?: CstNode[]
    LCurly?: IToken[]
    RCurly?: IToken[]
    blockItem?: CstNode[]
  }): NodeDecl | AreaDecl | undefined {
    const idTok = ctx.Identifier[0]!
    const id = idTok.image
    const idRange = makeRange(idTok, idTok)

    const label = ctx.labelOrValue
      ? (this.visit(ctx.labelOrValue) as LabelOrValueResult).text
      : undefined
    const labelRange = ctx.labelOrValue?.[0]
      ? this.labelValueRange(ctx.labelOrValue[0])
      : undefined

    const block = this.collectBlock(ctx)
    const endTok: IToken =
      ctx.RCurly?.[0] ??
      (ctx.labelOrValue?.[0]
        ? this.lastTokenOfLabel(ctx.labelOrValue[0])
        : undefined) ??
      idTok
    const range = makeRange(idTok, endTok)

    // No body at all: treat as a bare node declaration with default shape.
    if (!ctx.LCurly) {
      return makeNode(id, label, 'rectangle', range, idRange, labelRange)
    }

    const hasMembers = block.items.some((i) => i.kind === 'member')
    const hasAttrs = block.items.some((i) => i.kind === 'attr')

    if (hasMembers) {
      // Members + attrs in the same block aren't part of the subset.
      if (hasAttrs) {
        this.errors.push({
          message: `Container "${id}" mixes attributes and members; only one is allowed in an area.`,
          range,
        })
      }
      return this.buildArea(id, label, block, range)
    }

    return this.buildNode(id, label, block, range, idRange, labelRange)
  }

  private buildNode(
    id: string,
    label: string | undefined,
    block: BlockResult,
    range: SourceRange,
    idRange: SourceRange,
    labelRange: SourceRange | undefined,
  ): NodeDecl {
    let shape: ShapeName = 'rectangle'
    for (const item of block.items) {
      if (item.kind !== 'attr') continue
      if (item.path.length === 1 && item.path[0] === 'shape') {
        const value = item.value?.text
        if (value && (SHAPE_NAMES as readonly string[]).includes(value)) {
          shape = value as ShapeName
        } else {
          this.errors.push({
            message: `Unknown shape "${value ?? ''}" on node "${id}".`,
            range: item.range,
          })
        }
        continue
      }
      // Unknown attribute on a node — silently ignored for forward-compat,
      // except dotted paths longer than 2 which we explicitly reject.
      if (item.path.length > 2) {
        this.errors.push({
          message: `Unsupported dotted attribute "${item.path.join(
            '.',
          )}" on node "${id}".`,
          range: item.range,
        })
      }
    }
    return makeNode(id, label, shape, range, idRange, labelRange)
  }

  private buildArea(
    id: string,
    label: string | undefined,
    block: BlockResult,
    range: SourceRange,
  ): AreaDecl {
    const members: string[] = []
    const memberRanges: SourceRange[] = []
    for (const item of block.items) {
      if (item.kind !== 'member') continue
      const memberId = item.path[0]!
      if (members.includes(memberId)) {
        this.errors.push({
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

  // -- edge ---------------------------------------------------------------

  edgeDecl(ctx: {
    Identifier: IToken[]
    arrowOp: CstNode[]
    Colon?: IToken[]
    labelOrValue?: CstNode[]
    LCurly?: IToken[]
    RCurly?: IToken[]
    attr?: CstNode[]
  }): EdgeDecl {
    const sourceTok = ctx.Identifier[0]!
    const targetTok = ctx.Identifier[1]!
    const direction = this.visit(ctx.arrowOp) as EdgeDirection
    const label = ctx.labelOrValue
      ? (this.visit(ctx.labelOrValue) as LabelOrValueResult).text
      : undefined

    let style: EdgeStyle = 'solid'
    for (const a of ctx.attr ?? []) {
      const item = this.visit(a) as BlockItemResult
      if (item.kind !== 'attr') continue
      if (
        item.path.length === 2 &&
        item.path[0] === 'style' &&
        item.path[1] === 'stroke-dash'
      ) {
        style = strokeDashToStyle(item.value)
        continue
      }
      if (item.path.length > 2) {
        this.errors.push({
          message: `Unsupported dotted attribute "${item.path.join(
            '.',
          )}" on edge.`,
          range: item.range,
        })
      }
    }

    const endTok: IToken =
      ctx.RCurly?.[0] ??
      (ctx.labelOrValue?.[0]
        ? this.lastTokenOfLabel(ctx.labelOrValue[0])
        : undefined) ??
      targetTok
    const range = makeRange(sourceTok, endTok)

    return {
      kind: 'edge',
      source: sourceTok.image,
      target: targetTok.image,
      direction,
      label,
      style,
      range,
    }
  }

  arrowOp(ctx: {
    ArrowRight?: IToken[]
    ArrowLeft?: IToken[]
    ArrowBoth?: IToken[]
    DashDash?: IToken[]
  }): EdgeDirection {
    if (ctx.ArrowRight) return 'forward'
    if (ctx.ArrowLeft) return 'backward'
    if (ctx.ArrowBoth) return 'bidirectional'
    return 'none'
  }

  // -- block bodies -------------------------------------------------------

  blockItem(ctx: {
    attr?: CstNode[]
    memberStmt?: CstNode[]
  }): BlockItemResult {
    if (ctx.attr) return this.visit(ctx.attr) as BlockItemResult
    return this.visit(ctx.memberStmt!) as BlockItemResult
  }

  attr(ctx: {
    Identifier: IToken[]
    Dot?: IToken[]
    Colon: IToken[]
    attrValue: CstNode[]
  }): BlockItemResult {
    const path = ctx.Identifier.map((t) => t.image)
    const value = this.visit(ctx.attrValue) as AttrValue
    const range = makeRange(
      ctx.Identifier[0]!,
      this.lastTokenOfAttrValue(ctx.attrValue[0]!),
    )
    return { kind: 'attr', path, value, range }
  }

  memberStmt(ctx: { Identifier: IToken[] }): BlockItemResult {
    const tok = ctx.Identifier[0]!
    return {
      kind: 'member',
      path: [tok.image],
      range: makeRange(tok, tok),
    }
  }

  labelOrValue(ctx: {
    StringLit?: IToken[]
    Identifier?: IToken[]
  }): LabelOrValueResult {
    if (ctx.StringLit) {
      const tok = ctx.StringLit[0]!
      return { kind: 'string', text: unquote(tok.image) }
    }
    // Unquoted labels may span multiple identifier tokens; join with spaces.
    const text = ctx.Identifier!.map((t) => t.image).join(' ')
    return { kind: 'identifier', text }
  }

  attrValue(ctx: {
    StringLit?: IToken[]
    Identifier?: IToken[]
    NumberLit?: IToken[]
  }): AttrValue {
    if (ctx.StringLit) {
      const tok = ctx.StringLit[0]!
      return { kind: 'string', text: unquote(tok.image), raw: tok.image }
    }
    if (ctx.NumberLit) {
      const tok = ctx.NumberLit[0]!
      return { kind: 'number', text: tok.image, raw: tok.image }
    }
    const tok = ctx.Identifier![0]!
    return { kind: 'identifier', text: tok.image, raw: tok.image }
  }

  // -- helpers ------------------------------------------------------------

  private collectBlock(ctx: {
    LCurly?: IToken[]
    RCurly?: IToken[]
    blockItem?: CstNode[]
  }): BlockResult {
    const items: BlockItemResult[] = []
    for (const item of ctx.blockItem ?? []) {
      items.push(this.visit(item) as BlockItemResult)
    }
    const start = ctx.LCurly?.[0]
    const end = ctx.RCurly?.[0]
    const range: SourceRange = start && end
      ? makeRange(start, end)
      : { start: dummyPos(), end: dummyPos() }
    return { items, range }
  }

  private lastTokenOfLabel(node: CstNode): IToken | undefined {
    const ch = node.children as {
      StringLit?: IToken[]
      Identifier?: IToken[]
    }
    if (ch.StringLit?.[0]) return ch.StringLit[0]
    const ids = ch.Identifier
    return ids?.[ids.length - 1]
  }

  // Source span covering the label value: the StringLit (quotes included) or
  // the run of unquoted identifier tokens. Used to rewrite a node's label in
  // place from the canvas editor.
  private labelValueRange(node: CstNode): SourceRange | undefined {
    const ch = node.children as {
      StringLit?: IToken[]
      Identifier?: IToken[]
    }
    if (ch.StringLit?.[0]) return makeRange(ch.StringLit[0], ch.StringLit[0])
    const ids = ch.Identifier
    if (ids && ids.length > 0) return makeRange(ids[0]!, ids[ids.length - 1]!)
    return undefined
  }

  private lastTokenOfAttrValue(node: CstNode): IToken {
    const ch = node.children as {
      StringLit?: IToken[]
      Identifier?: IToken[]
      NumberLit?: IToken[]
    }
    return (ch.StringLit?.[0] ?? ch.NumberLit?.[0] ?? ch.Identifier![0])!
  }
}

// --- pure helpers --------------------------------------------------------

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

function makeRange(start: IToken, end: IToken): SourceRange {
  return {
    start: {
      line: start.startLine ?? 1,
      column: start.startColumn ?? 1,
      offset: start.startOffset,
    },
    end: {
      line: end.endLine ?? start.startLine ?? 1,
      column: (end.endColumn ?? start.startColumn ?? 1) + 1,
      offset: (end.endOffset ?? start.startOffset) + 1,
    },
  }
}

function dummyPos(): { line: number; column: number; offset: number } {
  return { line: 1, column: 1, offset: 0 }
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
