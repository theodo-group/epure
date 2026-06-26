import type { ShapeName } from '@/parser/ast'
import type {
  EndCap,
  FillColor,
  LineStyle,
  PaletteColor,
  Size,
} from '@/style/palette'

export type Side = 'N' | 'S' | 'E' | 'W'

export interface NodeStyle {
  textSize?: Size
  textColor?: PaletteColor
  borderColor?: PaletteColor
  borderStyle?: LineStyle
  fillColor?: FillColor
  /** Override the shape parsed from the D2 source. Useful from the style
   *  panel when the user wants to change a node's shape without editing the
   *  source. Unset → use the AST shape. */
  shape?: ShapeName
  /** Icon id from the bundled catalog (e.g. "aws/compute/ec2"). */
  icon?: string
  /** Where the icon sits on the node. `corner` (default) is a small badge in
   *  the bottom-right; `top` puts a larger icon centered above the label. */
  iconPosition?: 'corner' | 'top'
}

export interface EdgeStyleSpec {
  color?: PaletteColor
  lineStyle?: LineStyle
  width?: Size
  startCap?: EndCap
  endCap?: EndCap
  /** Nudge the label off its auto-computed anchor, in grid units (integers,
   *  may be negative). Absent → label sits at the routed default. Shared by
   *  every parallel edge of the same source→target pair (like the other
   *  style fields). */
  labelDx?: number
  labelDy?: number
}

export interface AreaStyleSpec {
  borderColor?: PaletteColor
  borderStyle?: LineStyle
  fillColor?: FillColor
}

export interface NodeLayout extends NodeStyle {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface AreaLayout extends AreaStyleSpec {
  id: string
  label?: string
  members: string[]
  x: number
  y: number
  w: number
  h: number
}

export interface EdgeEndpoint {
  nodeId: string
  side: Side
}

export interface EdgeRoute extends EdgeStyleSpec {
  id: string
  source: EdgeEndpoint
  target: EdgeEndpoint
  points: { x: number; y: number }[]
  labelAnchor?: { x: number; y: number }
}

export interface LayoutNode extends NodeStyle {
  cx: number
  cy: number
  w: number
  h: number
}

export interface LayoutEdge extends EdgeStyleSpec {
  sourceSide?: Side
  targetSide?: Side
}

export interface LayoutSidecar {
  gridSize: number
  nodes: Record<string, LayoutNode>
  edges: Record<string, LayoutEdge>
  /** Optional style overrides keyed by area id (matches AST area names). */
  areas?: Record<string, AreaStyleSpec>
}

export interface RoutedDiagram {
  gridSize: number
  nodes: NodeLayout[]
  areas: AreaLayout[]
  edges: EdgeRoute[]
}
