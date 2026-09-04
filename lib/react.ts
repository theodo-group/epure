// `@theodo-group/epure/react` — the editor's presentational SVG components,
// for embedding Épure diagrams in another React app (they SSR cleanly; this is
// exactly what the headless render in `@theodo-group/epure/render` draws with).

export { Node } from '../src/renderer/Node'
export { Edge, EdgeDefs, labelPillSize } from '../src/renderer/Edge'
export { Area, AreaLabel } from '../src/renderer/Area'
export { Grid } from '../src/renderer/Grid'
export type { EdgeMeta, NodeMeta } from '../src/renderer/Canvas'
