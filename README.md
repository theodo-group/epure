# Épure

> A grid-snapped, orthogonal-routed architecture-diagram editor that reads and writes a tiny D2 subset.

[![Build](https://img.shields.io/badge/build-TBD-lightgrey)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why

Existing D2 tooling auto-lays-out diagrams. Épure keeps the human in charge
of node placement and uses ELK only to route edges around fixed boxes. The
output is a pair of files small enough to review in a pull request: semantic
D2 source for the topology, and a JSON sidecar for the visuals. No SaaS, no
account, no lock-in — the editor is a single static page you can host
anywhere or open from disk.

## File format

A diagram is a pair of files sharing a basename, committed and reviewed together:

```d2
# system.epr.d2  — topology
api: API { shape: rectangle }
db: Postgres { shape: cylinder }
api -> db: "writes"

# groups list member ids (no `shape:`):
Backend: "Backend" {
  api
  db
}
```

```json
// system.epr.layout.json  — visuals (all geometry in integer grid units)
{
  "gridSize": 40,
  "nodes": {
    "api": { "cx": 8, "cy": 4, "w": 4, "h": 2, "borderColor": "purple" },
    "db":  { "cx": 16, "cy": 4, "w": 4, "h": 2, "borderColor": "teal" }
  },
  "edges": {
    "api->db": { "color": "teal", "lineStyle": "dashed", "sourceSide": "E", "targetSide": "W" }
  },
  "areas": {
    "Backend": { "borderColor": "purple", "fillColor": "purple" }
  }
}
```

The `.epr.d2` file is the canonical source of truth for topology (nodes, shapes,
edges, labels, and group membership). The `.epr.layout.json` sidecar owns each
node's **center** position `cx,cy` and size `w,h` (in grid units), the grid
pitch, per-element styling, area styling (keyed by area id — membership stays in
the `.d2`), and which side (N/S/E/W) each edge endpoint prefers. The full,
canonical example is [`fixtures/system.epr.*`](./fixtures); the schema is defined
by [`src/file/layoutSchema.ts`](./src/file/layoutSchema.ts).

## Editing live (the `epure` CLI / Claude Code)

The editor is a static page, but a tiny local server makes the file pair
**live-editable**: edits on disk appear instantly in the browser, and UI tweaks
(drag, restyle) are written back to the files for git to see.

```sh
npx epure ./docs/diagrams/system.epr.d2   # serves the UI + watches the pair; prints the URL
npx epure validate ./docs/diagrams/system.epr.d2   # parse + schema + cross-file checks
npx epure fmt ./docs/diagrams/system.epr.d2        # canonicalize the layout JSON
```

This is what makes Épure pleasant to drive from Claude Code: CC edits the pair
while the user watches it evolve. The bundled `epure-diagram` skill
(`npx epure skill install`) teaches CC the schema and workflow.

For a repo that keeps its diagrams in Épure, drop this into its `CLAUDE.md`:

```md
## Architecture diagrams (Épure)
Diagrams live as `<name>.epr.d2` + `<name>.epr.layout.json` pairs under `docs/diagrams/`.
- At session start, run `npx epure <file>.epr.d2 &` (idempotent — safe to re-run) and share the URL.
- Edit the pair directly; saves sync live to the open editor.
- Run `npx epure validate <file>.epr.d2` before finishing; keep diffs minimal with `npx epure fmt`.
```

## Icons

Any node may carry an official cloud / infra / tech logo from the
[mingrammer/diagrams](https://github.com/mingrammer/diagrams) icon set. The
reference lives in the JSON sidecar (never in the D2), so the topology stays
clean and the visual stays reviewable:

```json
"api": { "cx": 8, "cy": 4, "w": 4, "h": 2,
         "icon": "programming/framework/fastapi" }
```

- `icon` — a catalog id (`<provider>/<category>/<name>`), e.g. `aws/compute/lambda`.
  It renders as a small badge in the node's bottom-right corner. Omit it for a
  plain node.

Pick icons from the canvas: select a node and use the **Icon** control in the
style panel (searchable, filterable by provider). Exports inline each logo as a
base64 data URI, so PNG and standalone-HTML output stay fully self-contained.

The bundled catalog (`public/icons/` + `src/icons/catalog.generated.ts`) is
produced by `scripts/build-icon-catalog.mjs` from a checkout of
mingrammer/diagrams — see the script header to regenerate.

## Getting started

```sh
pnpm install
pnpm dev
```

Open the URL Vite prints. The dev page loads a fixture from `fixtures/` so
you can see a rendered diagram immediately.

Other useful scripts:

```sh
pnpm typecheck    # tsc --noEmit across the project
pnpm lint         # ESLint over src and tests
pnpm test         # Vitest, jsdom environment
pnpm build        # production bundle into dist/
pnpm preview      # serve the production build locally
```

Requires Node 20 or newer and pnpm 9 or newer.

## Roadmap

- **M1** — Vertical slice: Chevrotain parser, ELK libavoid wrapper, SVG
  renderer, and PNG export, all driven from a dev page that loads a fixed
  `.epr.d2` plus `.epr.layout.json` fixture.
- **M2** — Editor shell: dual-pane UI, CodeMirror with D2 highlighting,
  node drag with grid snap, edge anchor-side picker, areas, undo/redo, and
  open/save `.epr.zip`.
- **M3** — Shape library (cylinder, cloud, person, document), edge label
  placement, dashed/dotted styles, dark mode, keyboard shortcuts.
- **M4** — Standalone HTML export with inlined `svg-pan-zoom`, README,
  screenshots, deploy to GitHub Pages, open-source release.

## License

MIT. See [LICENSE](./LICENSE).
