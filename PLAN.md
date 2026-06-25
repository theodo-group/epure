# Épure

> A grid-snapped, orthogonal-routed architecture-diagram editor that reads and writes a tiny D2 subset.

## Context
Existing D2 tooling auto-lays-out diagrams; Épure keeps the human in charge of node placement and uses ELK only to route edges around fixed boxes. It replaces ad-hoc HTML-skill diagrams with a real editor whose output is reviewable in git (semantic `.epr.d2`) and reproducible (sidecar layout).

## File format
A diagram is a pair of files sharing a basename:

- `system.epr.d2` — D2 source. Owns: nodes, shapes, edges, labels, group membership.
- `system.epr.layout.json` — sidecar, source of truth for visuals. Owns: node center+size (`cx,cy,w,h` in integer grid units), grid size, per-element styling, area styling (keyed by area id; membership stays in the `.d2`), preferred anchor side per edge endpoint.

```d2
# system.epr.d2
api: API { shape: rectangle }
db: Postgres { shape: cylinder }
api -> db: "writes"

Backend: "Backend" { api \n db }
```

```json
// system.epr.layout.json  (geometry in integer grid units; see fixtures/system.epr.*)
{ "gridSize": 40,
  "nodes": { "api": {"cx":8,"cy":4,"w":4,"h":2},
             "db":  {"cx":16,"cy":4,"w":4,"h":2} },
  "edges": { "api->db": {"color":"teal","sourceSide":"E","targetSide":"W"} },
  "areas": { "Backend": {"borderColor":"purple","fillColor":"purple"} } }
```

## Architecture
- **parser** — Chevrotain grammar for the D2 subset; produces a typed AST with source positions.
- **layout-engine** — `@mr_mint/elkjs-libavoid` wrapper; pins each node's x/y/w/h, attaches 4 NSEW ports with `FIXED_POS`, returns orthogonal edge `sections`.
- **renderer** — React-rendered raw SVG: grid `<pattern>`, area rects, shape components (rectangle, cylinder, cloud, person, queue, document, page), edge polylines, labels.
- **editor** — Vite + React + TS shell; CodeMirror 6 (StreamLanguage) pane left, SVG canvas right via `react-resizable-panels`; Zustand store with `zundo` undo; pointer-event drag with snap-to-grid; File System Access API persisting an `.epr.zip` containing both files.
- **exporter** — native `XMLSerializer → Image → Canvas → toBlob` for PNG at 1x/2x/4x with inlined WOFF2; standalone HTML inlines the SVG + `svg-pan-zoom`.

## D2 subset supported
- Top-level node declarations: `id: "Label" { shape: <name> }`.
- Edges: `a -> b`, `a <- b`, `a <-> b`, `a -- b`, with optional `: "label"` and `{ style.stroke-dash: N }` (solid/dashed/dotted).
- One-level containers used **only** as areas: `area: "Label" { a; b }`.
- Comments (`#`), quoted and unquoted strings, significant newlines.
- Rejected at parse time: nested containers, dotted paths, globs, `near`, `icon`, `layers/scenarios/steps`, `classes`, `vars`.

## Anchors & routing
Each node emits four ports at the midpoint of its N/S/E/W sides, with `port.side` set accordingly. Nodes carry `portConstraints: FIXED_POS`. Edges reference ports by id derived from `edge.sourceSide`/`targetSide` in the sidecar. Libavoid's `shapeBufferDistance` and `idealNudgingDistance` are set equal to the diagram's `gridSize` so bends land on grid; we additionally post-snap every `bendPoint` to `round(p / gridSize) * gridSize` for safety.

## Milestones
- **M1** — Vertical slice: Chevrotain parser + ELK libavoid wrapper + SVG renderer + PNG export, driven from a CLI/`vite dev` page that loads a fixed `.epr.d2` + `.epr.layout.json` fixture.
- **M2** — Editor: dual-pane UI, CodeMirror with D2 highlighting, node drag with grid snap, edge anchor side picker, areas, undo/redo, open/save `.epr.zip`.
- **M3** — Shape library complete (cylinder/cloud/person/queue/document/page), edge label placement, dashed/dotted styles, dark mode, keyboard shortcuts.
- **M4** — Standalone HTML export with `svg-pan-zoom`, README, screenshots, deploy to GitHub Pages, open-source release.

## Out of scope (v1)
Nested areas; auto-layout of nodes; non-orthogonal/curved edges; multi-user or real-time collab; comments/threads; versioned history beyond local undo; embedding raster images inside nodes; theming engine; mobile/touch editing; Lezer incremental parsing; LSP.
