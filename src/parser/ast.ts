// Typed AST emitted by the D2-subset parser.
//
// Source ranges use 1-based lines/columns (matching Chevrotain tokens) and a
// 0-based byte offset; this lets editors map errors back to the CodeMirror
// document without extra bookkeeping.

export interface SourcePos {
  line: number
  column: number
  offset: number
}

export interface SourceRange {
  start: SourcePos
  end: SourcePos
}

export type ShapeName =
  | 'rectangle'
  | 'cylinder'
  | 'cloud'
  | 'person'
  | 'queue'
  | 'document'
  | 'page'

export const SHAPE_NAMES: readonly ShapeName[] = [
  'rectangle',
  'cylinder',
  'cloud',
  'person',
  'queue',
  'document',
  'page',
]

export type EdgeStyle = 'solid' | 'dashed' | 'dotted'

export type EdgeDirection = 'forward' | 'backward' | 'bidirectional' | 'none'

export interface NodeDecl {
  kind: 'node'
  id: string
  label?: string
  shape: ShapeName
  range: SourceRange
}

export interface EdgeDecl {
  kind: 'edge'
  source: string
  target: string
  direction: EdgeDirection
  label?: string
  style: EdgeStyle
  range: SourceRange
}

export interface AreaDecl {
  kind: 'area'
  id: string
  label?: string
  members: string[]
  range: SourceRange
}

export interface Diagram {
  nodes: NodeDecl[]
  edges: EdgeDecl[]
  areas: AreaDecl[]
}

export interface ParseError {
  message: string
  range: SourceRange
}

export type ParseResult =
  | { ok: true; diagram: Diagram }
  | { ok: false; errors: ParseError[] }
