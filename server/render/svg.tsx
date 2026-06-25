// Render a diagram model to a self-contained SVG string by SSR-ing the editor's
// own Node/Edge/Area components (zero rendering drift) into a fit-to-content
// viewBox, then inlining the icon PNGs as data URIs (a rasterizer can't fetch
// `/icons/...`). Omitting onSelect/onMove/onResize means no interactive handles
// render — just the diagram.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'

import { Area, AreaLabel } from '../../src/renderer/Area'
import { Edge, EdgeDefs } from '../../src/renderer/Edge'
import { Node } from '../../src/renderer/Node'
import type { RoutedDiagram } from '../../src/layout/types'
import type { EdgeMeta, NodeMeta } from '../../src/renderer/Canvas'

import type { RenderModel } from './model'

const DEFAULT_PADDING = 32

// Tight bounding box of everything drawn — areas, nodes, and every edge point.
// Mirrors the editor's fit logic so the export frames the diagram identically.
const computeBounds = (diagram: RoutedDiagram) => {
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
    // Labels below person nodes and corner badges overhang slightly.
    grow(n.x + n.w, n.y + n.h + 18)
  }
  for (const e of diagram.edges) for (const p of e.points) grow(p.x, p.y)

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 800, h: 600 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export interface SvgOptions {
  padding?: number
  background?: string
}

/** SSR the render model to an SVG string sized exactly to its content. */
export const renderSvgString = (model: RenderModel, opts: SvgOptions = {}): string => {
  const { routed, nodes, edges } = model
  const pad = opts.padding ?? DEFAULT_PADDING
  const b = computeBounds(routed)
  const x = b.x - pad
  const y = b.y - pad
  const w = Math.max(1, b.w + pad * 2)
  const h = Math.max(1, b.h + pad * 2)

  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${x} ${y} ${w} ${h}`}
      width={w}
      height={h}
    >
      <EdgeDefs />
      <rect x={x} y={y} width={w} height={h} fill={opts.background ?? '#ffffff'} />
      {routed.areas.map((area) => (
        <Area key={area.id} area={area} />
      ))}
      {routed.edges.map((edge) => {
        const m: Partial<EdgeMeta> = edges[edge.id] ?? {}
        return <Edge key={edge.id} edge={edge} label={m.label} style={m.style} marker={m.marker} />
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
    </svg>,
  )

  return markup
}

/**
 * Replace `href="/icons/<file>"` (or `xlink:href`) with inlined base64 data
 * URIs so the rasterizer renders the logos. Unknown/missing files are left
 * untouched (the rasterizer simply skips a broken href).
 */
export const inlineIcons = (svg: string, iconsDir: string): string =>
  svg.replace(
    /(xlink:href|href)="\/icons\/([^"]+)"/g,
    (whole, attr: string, file: string) => {
      try {
        const bytes = readFileSync(join(iconsDir, file))
        const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
        return `${attr}="data:${mime};base64,${bytes.toString('base64')}"`
      } catch {
        return whole
      }
    },
  )
