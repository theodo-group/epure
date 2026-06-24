import type {
  EndCap,
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
  fillColor?: PaletteColor
}

export interface EdgeStyleSpec {
  color?: PaletteColor
  lineStyle?: LineStyle
  width?: Size
  startCap?: EndCap
  endCap?: EndCap
}

export interface AreaStyleSpec {
  borderColor?: PaletteColor
  borderStyle?: LineStyle
  fillColor?: PaletteColor
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
