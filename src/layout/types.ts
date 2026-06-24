export type Side = 'N' | 'S' | 'E' | 'W'

export interface NodeLayout {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface AreaLayout {
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

export interface EdgeRoute {
  id: string
  source: EdgeEndpoint
  target: EdgeEndpoint
  points: { x: number; y: number }[]
  labelAnchor?: { x: number; y: number }
}

export interface LayoutNode {
  cx: number
  cy: number
  w: number
  h: number
}

export interface LayoutSidecar {
  gridSize: number
  nodes: Record<string, LayoutNode>
  edges: Record<string, { sourceSide: Side; targetSide: Side }>
}

export interface RoutedDiagram {
  gridSize: number
  nodes: NodeLayout[]
  areas: AreaLayout[]
  edges: EdgeRoute[]
}
