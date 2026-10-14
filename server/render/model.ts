// Build the render model (routed geometry + per-node/edge metadata) for a
// diagram pair, reusing the exact parse → normalize → route pipeline the editor
// uses. DOM-free, so it runs in Node for the headless PNG export.

import { parse } from '../../src/parser'
import { validateLayoutJson } from '../../src/file/layoutSchema'
import { route } from '../../src/layout/elk'
import { normalizeForRoute } from '../../src/layout/normalize'
import { emptyLayout } from '../../src/layout/defaults'
import { makeEdgeId } from '../../src/layout/ids'
import type { EdgeMeta, NodeMeta } from '../../src/renderer/Canvas'
import type { DiagramModel } from '../../src/renderer/Diagram'

/**
 * Parse + route a pair into a drawable DiagramModel. Returns `{ error }` when
 * the `.d2` doesn't parse (nothing meaningful to draw). An absent or invalid
 * layout is tolerated; normalization auto-places any unplaced node.
 */
export const model = async (
  d2: string,
  layoutText: string | null,
): Promise<DiagramModel | { error: string }> => {
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
    layoutText !== null ? (validateLayoutJson(layoutText).value ?? emptyLayout()) : emptyLayout()

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

  return { routed, nodes, edges, textScale: layout.textScale }
}
