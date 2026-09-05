// The whole diagram as one presentational component: give it a DiagramModel
// (from `model()` in @theodo-group/epure/render) and it draws the editor's
// exact look into a fit-to-content <svg>. SSR-clean and DOM-free, so it works
// in any React app; the headless SVG/PNG export renders exactly this.

import { computeCrossings } from '../layout/crossings'
import type { RoutedDiagram } from '../layout/types'
import { Area, AreaLabel } from './Area'
import type { EdgeMeta, NodeMeta } from './Canvas'
import { Edge, EdgeDefs, labelPillSize } from './Edge'
import { Node } from './Node'

/** Routed geometry + per-node/edge metadata: everything Diagram needs. */
export interface DiagramModel {
  routed: RoutedDiagram
  /** Topology metadata keyed by node id (shape + label come from the `.d2`). */
  nodes: Record<string, NodeMeta>
  /** Edge metadata keyed by routed edge id (`src->tgt#i`). */
  edges: Record<string, EdgeMeta>
}

export interface DiagramOptions {
  /** Whitespace around the content bounds, in diagram px. */
  padding?: number
  background?: string
}

const DEFAULT_PADDING = 32

// Tight bounding box of everything drawn: areas, nodes, every edge point, and
// every edge-label pill. Mirrors the editor's fit logic so the frame matches
// the diagram identically. Label pills matter because a user can nudge a label
// (labelDx/labelDy) well off its edge; left out of the bounds it would clip.
const computeBounds = (diagram: RoutedDiagram, edgeMeta: Record<string, Partial<EdgeMeta>>) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const a of diagram.areas) {
    grow(a.x, a.y)
    grow(a.x + a.w, a.y + a.h)
    // Area labels straddle the top border and sit ~14px left of the box.
    grow(a.x, a.y - 12)
  }
  for (const n of diagram.nodes) {
    grow(n.x, n.y)
    grow(n.x + n.w, n.y + n.h)
    // Labels below person nodes and corner badges overhang slightly. Keep this
    // in sync with LABEL_BELOW_GAP + LINE_HEIGHT in Node.tsx (plus descender).
    grow(n.x + n.w, n.y + n.h + 26)
  }
  for (const e of diagram.edges) {
    for (const p of e.points) grow(p.x, p.y)
    // The label pill (centered on labelAnchor), sized at the default textScale
    // of 1, matching how Edge renders outside the editor.
    const label = edgeMeta[e.id]?.label
    if (label && e.labelAnchor) {
      const { w: pillW, h: pillH } = labelPillSize(label)
      grow(e.labelAnchor.x - pillW / 2, e.labelAnchor.y - pillH / 2)
      grow(e.labelAnchor.x + pillW / 2, e.labelAnchor.y + pillH / 2)
    }
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 800, h: 600 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** The diagram, framed to its content. Purely presentational: no interactive
 *  handles render (those belong to the editor's canvas). */
export const Diagram = ({ model, padding, background }: { model: DiagramModel } & DiagramOptions) => {
  const { routed, nodes, edges } = model
  const pad = padding ?? DEFAULT_PADDING
  const b = computeBounds(routed, edges)
  // Same crossing pass the live canvas runs, so gaps fade identically.
  const crossings = computeCrossings(routed.edges)
  const x = b.x - pad
  const y = b.y - pad
  const w = Math.max(1, b.w + pad * 2)
  const h = Math.max(1, b.h + pad * 2)

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x} ${y} ${w} ${h}`} width={w} height={h}>
      <EdgeDefs />
      <rect x={x} y={y} width={w} height={h} fill={background ?? '#ffffff'} />
      {routed.areas.map((area) => (
        <Area key={area.id} area={area} />
      ))}
      {routed.edges.map((edge) => {
        const m: Partial<EdgeMeta> = edges[edge.id] ?? {}
        return (
          <Edge
            key={edge.id}
            edge={edge}
            label={m.label}
            style={m.style}
            marker={m.marker}
            crossings={crossings.get(edge.id)}
          />
        )
      })}
      {routed.nodes.map((node) => {
        const m: Partial<NodeMeta> = nodes[node.id] ?? {}
        return (
          <Node
            key={node.id}
            id={node.id}
            shape={node.shape ?? m.shape ?? 'rectangle'}
            label={m.label}
            x={node.x}
            y={node.y}
            w={node.w}
            h={node.h}
            textSize={node.textSize}
            textColor={node.textColor}
            borderColor={node.borderColor}
            borderStyle={node.borderStyle}
            fillColor={node.fillColor}
            icon={node.icon}
            iconPosition={node.iconPosition}
            gridSize={routed.gridSize}
          />
        )
      })}
      {routed.areas.map((area) => (
        <AreaLabel key={`label-${area.id}`} area={area} />
      ))}
    </svg>
  )
}
