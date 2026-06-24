import { forwardRef, useMemo, type MouseEvent } from 'react'

import type { EdgeDirection, EdgeStyle, ShapeName } from '@/parser/ast'
import type { RoutedDiagram } from '@/layout/types'

import { Area } from './Area'
import { Edge, EdgeDefs } from './Edge'
import { Grid } from './Grid'
import { Node } from './Node'

export interface NodeMeta {
  shape: ShapeName
  label?: string
}

export interface EdgeMeta {
  label?: string
  style?: EdgeStyle
  marker?: EdgeDirection
}

interface CanvasProps {
  diagram: RoutedDiagram
  showGrid: boolean
  selectedNodeId?: string
  onSelectNode?: (id: string) => void
  onMoveNode?: (id: string, centerX: number, centerY: number) => void
  /** Per-node visual metadata (shape, label). Falls back to rectangle. */
  nodes?: Record<string, NodeMeta>
  /** Per-edge visual metadata (label, style, marker). */
  edges?: Record<string, EdgeMeta>
  /** Padding around content when computing the fit-to-content viewBox. */
  padding?: number
}

const computeBounds = (diagram: RoutedDiagram) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const a of diagram.areas) {
    minX = Math.min(minX, a.x)
    minY = Math.min(minY, a.y)
    maxX = Math.max(maxX, a.x + a.w)
    maxY = Math.max(maxY, a.y + a.h)
  }
  for (const n of diagram.nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  for (const e of diagram.edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }

  if (!isFinite(minX)) {
    return { x: 0, y: 0, w: 800, h: 600 }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const Canvas = forwardRef<SVGSVGElement, CanvasProps>(
  (
    {
      diagram,
      showGrid,
      selectedNodeId,
      onSelectNode,
      onMoveNode,
      nodes = {},
      edges = {},
      padding = 32,
    },
    ref,
  ) => {
    const view = useMemo(() => {
      const b = computeBounds(diagram)
      return {
        x: b.x - padding,
        y: b.y - padding,
        w: b.w + padding * 2,
        h: b.h + padding * 2,
      }
    }, [diagram, padding])

    const handleBackgroundClick = (event: MouseEvent<SVGSVGElement>) => {
      if (event.target === event.currentTarget) onSelectNode?.('')
    }

    return (
      <svg
        ref={ref}
        xmlns='http://www.w3.org/2000/svg'
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio='xMidYMid meet'
        onClick={handleBackgroundClick}
      >
        <EdgeDefs />
        <g>
          {showGrid ? (
            <Grid
              x={view.x}
              y={view.y}
              width={view.w}
              height={view.h}
              gridSize={diagram.gridSize}
            />
          ) : null}
          {diagram.areas.map((area) => (
            <Area key={area.id} area={area} />
          ))}
          {diagram.edges.map((edge) => {
            const meta = edges[edge.id] ?? {}
            return (
              <Edge
                key={edge.id}
                edge={edge}
                label={meta.label}
                style={meta.style}
                marker={meta.marker}
              />
            )
          })}
          {diagram.nodes.map((node) => {
            const meta = nodes[node.id] ?? { shape: 'rectangle' as ShapeName }
            return (
              <Node
                key={node.id}
                id={node.id}
                shape={meta.shape ?? 'rectangle'}
                label={meta.label}
                x={node.x}
                y={node.y}
                w={node.w}
                h={node.h}
                selected={selectedNodeId === node.id}
                onSelect={onSelectNode}
                onMove={onMoveNode}
                gridSize={diagram.gridSize}
              />
            )
          })}
        </g>
      </svg>
    )
  },
)

Canvas.displayName = 'Canvas'
