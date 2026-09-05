// `@theodo-group/epure/react`: the diagram as a React component, plus the
// presentational parts it is made of. SSR-clean; the headless render in
// `@theodo-group/epure/render` draws exactly this.
//
//   const m = await model(d2, layoutJson)   // @theodo-group/epure/render
//   return <Diagram model={m} />

export { Diagram, type DiagramModel, type DiagramOptions } from '../src/renderer/Diagram'
export { Node } from '../src/renderer/Node'
export { Edge, EdgeDefs, labelPillSize } from '../src/renderer/Edge'
export { Area, AreaLabel } from '../src/renderer/Area'
export { Grid } from '../src/renderer/Grid'
export type { EdgeMeta, NodeMeta } from '../src/renderer/Canvas'
