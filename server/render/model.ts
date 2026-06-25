// Build the render model (routed geometry + per-node/edge metadata) for a
// diagram pair, reusing the exact parse → normalize → route pipeline the editor
// uses. DOM-free, so it runs in Node for the headless PNG export.

import { parse } from '../../src/parser'
import { validateLayoutJson } from '../../src/file/layoutSchema'
import { route } from '../../src/layout/elk'
import { normalizeForRoute } from '../../src/layout/normalize'
import { makeEdgeId } from '../../src/layout/elk'
import type { LayoutSidecar, RoutedDiagram } from '../../src/layout/types'
import type { EdgeMeta, NodeMeta } from '../../src/renderer/Canvas'

export interface RenderModel {
  routed: RoutedDiagram
  /** Topology metadata keyed by node id (shape + label come from the `.d2`). */
  nodes: Record<string, NodeMeta>
  /** Edge metadata keyed by routed edge id (`src->tgt#i`). */
  edges: Record<string, EdgeMeta>
}

const fallbackLayout = (): LayoutSidecar => ({ gridSize: 40, nodes: {}, edges: {} })

/**
 * Parse + route a pair into a render model. Returns `{ error }` when the `.d2`
 * doesn't parse (nothing meaningful to draw). An absent/invalid layout is
 * tolerated — Phase-0 normalization auto-places any unplaced node.
 */
export const buildRenderModel = async (
  d2: string,
  layoutText: string | null,
): Promise<RenderModel | { error: string }> => {
  const parsed = parse(d2)
  if (!parsed.ok) {
    const first = parsed.errors[0]
    return {
      error: first
        ? `${first.range.start.line}:${first.range.start.column} ${first.message}`
        : 'parse error',
    }
  }

  const layout =
    layoutText !== null
      ? (validateLayoutJson(layoutText).value ?? fallbackLayout())
      : fallbackLayout()

  const routed = await route(parsed.diagram, normalizeForRoute(parsed.diagram, layout))

  const nodes: Record<string, NodeMeta> = {}
  for (const node of parsed.diagram.nodes) {
    nodes[node.id] = { shape: node.shape, label: node.label }
  }
  const edges: Record<string, EdgeMeta> = {}
  parsed.diagram.edges.forEach((edge, i) => {
    edges[makeEdgeId(edge.source, edge.target, i)] = {
      label: edge.label,
      style: edge.style,
      marker: edge.direction,
    }
  })

  return { routed, nodes, edges }
}
