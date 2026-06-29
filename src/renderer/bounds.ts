import type { RoutedDiagram } from '@/layout/types'

import { labelPillSize } from './Edge'

/**
 * Tight bounding box of everything drawn — areas, nodes, every edge point, and
 * every edge-label pill. Shared by the canvas's Fit action and the PNG export
 * so the two frame the diagram identically: "Export PNG" reproduces exactly what
 * "Fit" shows. A nudged label (labelDx/labelDy) can sit well off its edge, so it
 * is grown into the box using the same pill geometry the renderer draws with.
 *
 * `edges` only needs each entry's `label` (to size its pill); pass the same
 * EdgeMeta map the canvas renders with.
 */
export const computeContentBounds = (
  diagram: RoutedDiagram,
  edges: Record<string, { label?: string } | undefined> = {},
  textScale = 1,
): { x: number; y: number; w: number; h: number } => {
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
    const label = edges[e.id]?.label
    if (e.labelAnchor && label) {
      const { w: pillW, h: pillH } = labelPillSize(label, textScale)
      minX = Math.min(minX, e.labelAnchor.x - pillW / 2)
      minY = Math.min(minY, e.labelAnchor.y - pillH / 2)
      maxX = Math.max(maxX, e.labelAnchor.x + pillW / 2)
      maxY = Math.max(maxY, e.labelAnchor.y + pillH / 2)
    }
  }

  if (!isFinite(minX)) return { x: 0, y: 0, w: 800, h: 600 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
