// Edge identity, in one place. The layout sidecar keys an edge's style by its
// endpoint pair, `source->target`, so parallel edges share one style. The
// canvas, the selection and the routed diagram need each edge on its own, so
// the parser AST's edges (which carry no id) get the pair plus their index in
// the diagram: `source->target#i`.

/** The sidecar key (`layout.edges[…]`) for edges from `source` to `target`. */
export const edgeKey = (source: string, target: string): string => `${source}->${target}`

/** A per-edge id: the pair plus the edge's index in `diagram.edges`. */
export const makeEdgeId = (source: string, target: string, index: number): string =>
  `${edgeKey(source, target)}#${index}`

/** The sidecar key an edge id belongs to (inverse of `makeEdgeId`, minus the index). */
export const edgeKeyOfId = (edgeId: string): string => edgeId.split('#')[0] ?? edgeId
