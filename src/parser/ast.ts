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

export type ShapeName = 'rectangle' | 'cylinder' | 'person'

export const SHAPE_NAMES: readonly ShapeName[] = [
  'rectangle',
  'cylinder',
  'person',
]

export type EdgeStyle = 'solid' | 'dashed' | 'dotted'

export type EdgeDirection = 'forward' | 'backward' | 'bidirectional' | 'none'

export interface NodeDecl {
  kind: 'node'
  id: string
  label?: string
  shape: ShapeName
  range: SourceRange
  /** Span of just the id token — the insertion point for a `: "label"` when the
   *  node has no label yet (used by the canvas label editor to write back). */
  idRange: SourceRange
  /** Span of the label value in the source (quotes included for a quoted
   *  label), when the node declares one. Lets the editor replace the label
   *  in place without reformatting the rest of the declaration. */
  labelRange?: SourceRange
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
  /** Source span of each member's id token, parallel to `members`. Lets an edit
   *  remove a single member from the block (e.g. when its node is deleted)
   *  without touching the rest of the declaration. */
  memberRanges: SourceRange[]
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
