// Position-aware JSON validator for the layout sidecar.
//
// `JSON.parse` is fine for execution, but it loses the line/column of every
// token — so a schema violation has nowhere to surface. This module ships a
// tiny JSON parser that remembers the source range of every value, then walks
// the parse tree to produce `ParseError`s that the editor renders inline (same
// pipeline as the D2 parser errors).

import type { ParseError, SourceRange, SourcePos } from '@/parser/ast'
import type { LayoutSidecar } from '@/layout/types'
import { iconById } from '@/icons'

type JsonNode =
  | { kind: 'object'; range: SourceRange; entries: ObjectEntry[] }
  | { kind: 'array'; range: SourceRange; items: JsonNode[] }
  | { kind: 'string'; range: SourceRange; value: string }
  | { kind: 'number'; range: SourceRange; value: number }
  | { kind: 'boolean'; range: SourceRange; value: boolean }
  | { kind: 'null'; range: SourceRange }

interface ObjectEntry {
  key: string
  keyRange: SourceRange
  value: JsonNode
}

interface PositionedError extends Error {
  range: SourceRange
}

class JsonParser {
  private i = 0
  private line = 1
  private col = 1

  constructor(private readonly text: string) {}

  parse(): JsonNode {
    this.skipWs()
    const root = this.parseValue()
    this.skipWs()
    if (this.i < this.text.length) {
      throw this.error(`Unexpected trailing content`, this.pos())
    }
    return root
  }

  private pos(): SourcePos {
    return { line: this.line, column: this.col, offset: this.i }
  }

  private rangeFrom(start: SourcePos): SourceRange {
    return { start, end: this.pos() }
  }

  private advance(n = 1): void {
    for (let k = 0; k < n; k++) {
      const ch = this.text[this.i]
      if (ch === '\n') {
        this.line += 1
        this.col = 1
      } else {
        this.col += 1
      }
      this.i += 1
    }
  }

  private peek(): string | undefined {
    return this.text[this.i]
  }

  private skipWs(): void {
    while (this.i < this.text.length) {
      const ch = this.text[this.i]
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance()
      } else {
        break
      }
    }
  }

  private error(message: string, start: SourcePos): PositionedError {
    const end: SourcePos = {
      line: start.line,
      column: start.column + 1,
      offset: Math.min(this.text.length, start.offset + 1),
    }
    const err = new Error(message) as PositionedError
    err.range = { start, end }
    return err
  }

  private parseValue(): JsonNode {
    this.skipWs()
    const ch = this.peek()
    if (ch === undefined) throw this.error('Unexpected end of input', this.pos())
    if (ch === '{') return this.parseObject()
    if (ch === '[') return this.parseArray()
    if (ch === '"') return this.parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber()
    if (this.text.startsWith('true', this.i)) {
      const start = this.pos()
      this.advance(4)
      return { kind: 'boolean', range: this.rangeFrom(start), value: true }
    }
    if (this.text.startsWith('false', this.i)) {
      const start = this.pos()
      this.advance(5)
      return { kind: 'boolean', range: this.rangeFrom(start), value: false }
    }
    if (this.text.startsWith('null', this.i)) {
      const start = this.pos()
      this.advance(4)
      return { kind: 'null', range: this.rangeFrom(start) }
    }
    throw this.error(`Unexpected character '${ch}'`, this.pos())
  }

  private parseObject(): JsonNode {
    const start = this.pos()
    this.advance() // {
    const entries: ObjectEntry[] = []
    this.skipWs()
    if (this.peek() === '}') {
      this.advance()
      return { kind: 'object', range: this.rangeFrom(start), entries }
    }
    while (true) {
      this.skipWs()
      if (this.peek() !== '"') {
        throw this.error('Expected string key', this.pos())
      }
      const keyStart = this.pos()
      const keyNode = this.parseString()
      const keyRange = { start: keyStart, end: this.pos() }
      this.skipWs()
      if (this.peek() !== ':') {
        throw this.error(`Expected ':' after key`, this.pos())
      }
      this.advance()
      const value = this.parseValue()
      entries.push({ key: keyNode.kind === 'string' ? keyNode.value : '', keyRange, value })
      this.skipWs()
      const next = this.peek()
      if (next === ',') {
        this.advance()
        continue
      }
      if (next === '}') {
        this.advance()
        break
      }
      throw this.error(`Expected ',' or '}'`, this.pos())
    }
    return { kind: 'object', range: this.rangeFrom(start), entries }
  }

  private parseArray(): JsonNode {
    const start = this.pos()
    this.advance() // [
    const items: JsonNode[] = []
    this.skipWs()
    if (this.peek() === ']') {
      this.advance()
      return { kind: 'array', range: this.rangeFrom(start), items }
    }
    while (true) {
      items.push(this.parseValue())
      this.skipWs()
      const next = this.peek()
      if (next === ',') {
        this.advance()
        continue
      }
      if (next === ']') {
        this.advance()
        break
      }
      throw this.error(`Expected ',' or ']'`, this.pos())
    }
    return { kind: 'array', range: this.rangeFrom(start), items }
  }

  private parseString(): JsonNode {
    const start = this.pos()
    this.advance() // opening quote
    let value = ''
    while (this.i < this.text.length) {
      const ch = this.peek()!
      if (ch === '"') {
        this.advance()
        return { kind: 'string', range: this.rangeFrom(start), value }
      }
      if (ch === '\n') {
        throw this.error('Unterminated string', this.pos())
      }
      if (ch === '\\') {
        this.advance()
        const esc = this.peek()
        if (esc === undefined) throw this.error('Unterminated escape', this.pos())
        switch (esc) {
          case '"': value += '"'; this.advance(); break
          case '\\': value += '\\'; this.advance(); break
          case '/': value += '/'; this.advance(); break
          case 'b': value += '\b'; this.advance(); break
          case 'f': value += '\f'; this.advance(); break
          case 'n': value += '\n'; this.advance(); break
          case 'r': value += '\r'; this.advance(); break
          case 't': value += '\t'; this.advance(); break
          case 'u': {
            this.advance()
            const hex = this.text.slice(this.i, this.i + 4)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw this.error('Invalid unicode escape', this.pos())
            }
            value += String.fromCharCode(parseInt(hex, 16))
            this.advance(4)
            break
          }
          default:
            throw this.error(`Invalid escape \\${esc}`, this.pos())
        }
        continue
      }
      value += ch
      this.advance()
    }
    throw this.error('Unterminated string', this.pos())
  }

  private parseNumber(): JsonNode {
    const start = this.pos()
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
    match.lastIndex = this.i
    const m = match.exec(this.text)
    if (!m) throw this.error('Invalid number', start)
    this.advance(m[0].length)
    return { kind: 'number', range: this.rangeFrom(start), value: parseFloat(m[0]) }
  }
}

// ── Schema ────────────────────────────────────────────────────────────────
// Single-source-of-truth enums, mirrored from src/style/palette.ts and the
// layout/types module. Kept inline (not imported as values) because palette.ts
// holds them as TS string-literal unions, not runtime arrays.

// Exported so docs/skill drift-checks can assert against the single source of
// truth rather than a hand-copied list (see tests/skillSchema.test.ts).
export const PALETTE_COLORS = new Set([
  'black', 'gray', 'red', 'orange', 'yellow',
  'green', 'teal', 'blue', 'purple', 'pink',
])
export const FILL_COLORS = new Set([...PALETTE_COLORS, 'transparent', 'white'])
export const SIZES = new Set(['S', 'M', 'L', 'XL'])
export const LINE_STYLES = new Set(['solid', 'dashed', 'dotted'])
export const END_CAPS = new Set(['none', 'arrow', 'dot', 'diamond'])
export const ICON_POSITIONS = new Set(['corner', 'top'])
export const SIDES = new Set(['N', 'S', 'E', 'W'])

const NODE_FIELDS = new Set([
  'cx', 'cy', 'w', 'h',
  'textSize', 'textColor', 'borderColor', 'borderStyle',
  'fillColor', 'icon', 'iconPosition', 'shape',
])
export const SHAPES = new Set(['rectangle', 'cylinder', 'person'])
const EDGE_FIELDS = new Set([
  'color', 'lineStyle', 'width', 'startCap', 'endCap',
  'sourceSide', 'targetSide',
])
const AREA_FIELDS = new Set(['borderColor', 'borderStyle', 'fillColor'])
const ROOT_FIELDS = new Set(['gridSize', 'nodes', 'edges', 'areas'])

interface Ctx {
  errors: ParseError[]
}

const push = (ctx: Ctx, message: string, range: SourceRange): void => {
  ctx.errors.push({ message, range })
}

const validateEnum = (
  node: JsonNode,
  allowed: Set<string>,
  label: string,
  ctx: Ctx,
): void => {
  if (node.kind !== 'string') {
    push(ctx, `${label} must be a string`, node.range)
    return
  }
  if (!allowed.has(node.value)) {
    const list = [...allowed].join(', ')
    push(ctx, `${label} must be one of: ${list}`, node.range)
  }
}

interface NumberOpts {
  integer?: boolean
  min?: number
}

const validateNumber = (
  node: JsonNode,
  label: string,
  ctx: Ctx,
  opts: NumberOpts = {},
): void => {
  if (node.kind !== 'number') {
    push(ctx, `${label} must be a number`, node.range)
    return
  }
  if (opts.integer && !Number.isInteger(node.value)) {
    push(ctx, `${label} must be an integer`, node.range)
  }
  if (opts.min !== undefined && node.value < opts.min) {
    push(ctx, `${label} must be ≥ ${opts.min}`, node.range)
  }
}

const validateNode = (node: JsonNode, key: string, ctx: Ctx): void => {
  if (node.kind !== 'object') {
    push(ctx, `Node "${key}" must be an object`, node.range)
    return
  }
  const seen = new Set<string>()
  for (const entry of node.entries) {
    if (seen.has(entry.key)) {
      push(ctx, `Duplicate field "${entry.key}"`, entry.keyRange)
    }
    seen.add(entry.key)
    switch (entry.key) {
      case 'cx':
      case 'cy':
        validateNumber(entry.value, entry.key, ctx, { integer: true })
        break
      case 'w':
      case 'h':
        validateNumber(entry.value, entry.key, ctx, { integer: true, min: 1 })
        break
      case 'textSize':
        validateEnum(entry.value, SIZES, 'textSize', ctx)
        break
      case 'textColor':
      case 'borderColor':
        validateEnum(entry.value, PALETTE_COLORS, entry.key, ctx)
        break
      case 'fillColor':
        validateEnum(entry.value, FILL_COLORS, 'fillColor', ctx)
        break
      case 'borderStyle':
        validateEnum(entry.value, LINE_STYLES, 'borderStyle', ctx)
        break
      case 'iconPosition':
        validateEnum(entry.value, ICON_POSITIONS, 'iconPosition', ctx)
        break
      case 'shape':
        validateEnum(entry.value, SHAPES, 'shape', ctx)
        break
      case 'icon':
        if (entry.value.kind !== 'string') {
          push(ctx, 'icon must be a string', entry.value.range)
        } else if (!iconById(entry.value.value)) {
          push(ctx, `Unknown icon "${entry.value.value}"`, entry.value.range)
        }
        break
      default:
        if (!NODE_FIELDS.has(entry.key)) {
          push(ctx, `Unknown node field "${entry.key}"`, entry.keyRange)
        }
    }
  }
  for (const req of ['cx', 'cy', 'w', 'h'] as const) {
    if (!seen.has(req)) {
      push(ctx, `Node "${key}" is missing "${req}"`, node.range)
    }
  }
}

const validateEdge = (node: JsonNode, key: string, ctx: Ctx): void => {
  if (node.kind !== 'object') {
    push(ctx, `Edge "${key}" must be an object`, node.range)
    return
  }
  const seen = new Set<string>()
  for (const entry of node.entries) {
    if (seen.has(entry.key)) {
      push(ctx, `Duplicate field "${entry.key}"`, entry.keyRange)
    }
    seen.add(entry.key)
    switch (entry.key) {
      case 'color':
        validateEnum(entry.value, PALETTE_COLORS, 'color', ctx)
        break
      case 'lineStyle':
        validateEnum(entry.value, LINE_STYLES, 'lineStyle', ctx)
        break
      case 'width':
        validateEnum(entry.value, SIZES, 'width', ctx)
        break
      case 'startCap':
      case 'endCap':
        validateEnum(entry.value, END_CAPS, entry.key, ctx)
        break
      case 'sourceSide':
      case 'targetSide':
        validateEnum(entry.value, SIDES, entry.key, ctx)
        break
      default:
        if (!EDGE_FIELDS.has(entry.key)) {
          push(ctx, `Unknown edge field "${entry.key}"`, entry.keyRange)
        }
    }
  }
}

const validateArea = (node: JsonNode, key: string, ctx: Ctx): void => {
  if (node.kind !== 'object') {
    push(ctx, `Area "${key}" must be an object`, node.range)
    return
  }
  const seen = new Set<string>()
  for (const entry of node.entries) {
    if (seen.has(entry.key)) {
      push(ctx, `Duplicate field "${entry.key}"`, entry.keyRange)
    }
    seen.add(entry.key)
    switch (entry.key) {
      case 'borderColor':
        validateEnum(entry.value, PALETTE_COLORS, 'borderColor', ctx)
        break
      case 'borderStyle':
        validateEnum(entry.value, LINE_STYLES, 'borderStyle', ctx)
        break
      case 'fillColor':
        validateEnum(entry.value, FILL_COLORS, 'fillColor', ctx)
        break
      default:
        if (!AREA_FIELDS.has(entry.key)) {
          push(ctx, `Unknown area field "${entry.key}"`, entry.keyRange)
        }
    }
  }
}

const validateMap = (
  node: JsonNode,
  label: string,
  ctx: Ctx,
  validate: (entryValue: JsonNode, key: string, ctx: Ctx) => void,
): void => {
  if (node.kind !== 'object') {
    push(ctx, `${label} must be an object`, node.range)
    return
  }
  const seen = new Set<string>()
  for (const entry of node.entries) {
    if (seen.has(entry.key)) {
      push(ctx, `Duplicate key "${entry.key}"`, entry.keyRange)
    }
    seen.add(entry.key)
    validate(entry.value, entry.key, ctx)
  }
}

const validateRoot = (node: JsonNode, ctx: Ctx): void => {
  if (node.kind !== 'object') {
    push(ctx, 'Layout root must be an object', node.range)
    return
  }
  const seen = new Set<string>()
  for (const entry of node.entries) {
    if (seen.has(entry.key)) {
      push(ctx, `Duplicate field "${entry.key}"`, entry.keyRange)
    }
    seen.add(entry.key)
    switch (entry.key) {
      case 'gridSize':
        validateNumber(entry.value, 'gridSize', ctx, { integer: true, min: 1 })
        break
      case 'nodes':
        validateMap(entry.value, 'nodes', ctx, validateNode)
        break
      case 'edges':
        validateMap(entry.value, 'edges', ctx, validateEdge)
        break
      case 'areas':
        validateMap(entry.value, 'areas', ctx, validateArea)
        break
      default:
        if (!ROOT_FIELDS.has(entry.key)) {
          push(ctx, `Unknown root field "${entry.key}"`, entry.keyRange)
        }
    }
  }
  for (const req of ['gridSize', 'nodes', 'edges'] as const) {
    if (!seen.has(req)) {
      push(ctx, `Layout is missing "${req}"`, node.range)
    }
  }
}

const nodeToValue = (node: JsonNode): unknown => {
  switch (node.kind) {
    case 'string': return node.value
    case 'number': return node.value
    case 'boolean': return node.value
    case 'null': return null
    case 'array': return node.items.map(nodeToValue)
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const entry of node.entries) out[entry.key] = nodeToValue(entry.value)
      return out
    }
  }
}

export interface LayoutValidationResult {
  /** Parsed value when JSON syntax + schema both pass; null otherwise. */
  value: LayoutSidecar | null
  errors: ParseError[]
}

export const validateLayoutJson = (text: string): LayoutValidationResult => {
  let root: JsonNode
  try {
    root = new JsonParser(text).parse()
  } catch (e) {
    const err = e as PositionedError
    return {
      value: null,
      errors: [{ message: err.message, range: err.range }],
    }
  }
  const ctx: Ctx = { errors: [] }
  validateRoot(root, ctx)
  if (ctx.errors.length > 0) {
    return { value: null, errors: ctx.errors }
  }
  return { value: nodeToValue(root) as LayoutSidecar, errors: [] }
}
