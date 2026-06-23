# archgrid

> A grid-snapped, orthogonal-routed architecture-diagram editor that reads and writes a tiny D2 subset.

[![Build](https://img.shields.io/badge/build-TBD-lightgrey)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why

Existing D2 tooling auto-lays-out diagrams. archgrid keeps the human in charge
of node placement and uses ELK only to route edges around fixed boxes. The
output is a pair of files small enough to review in a pull request: semantic
D2 source for the topology, and a JSON sidecar for the visuals. No SaaS, no
account, no lock-in — the editor is a single static page you can host
anywhere or open from disk.

## File format

A diagram is a pair of files sharing a basename, persisted together as a
single `.arch.zip`:

```d2
# system.arch.d2
api: API { shape: rectangle }
db: Postgres { shape: cylinder }
api -> db: "writes" { style.stroke-dash: 3 }
```

```json
// system.arch.layout.json
{
  "gridSize": 16,
  "nodes": {
    "api": { "x": 64, "y": 64, "w": 160, "h": 64 },
    "db":  { "x": 384, "y": 64, "w": 160, "h": 64 }
  },
  "edges": {
    "api->db": { "sourceSide": "E", "targetSide": "W" }
  },
  "areas": [
    { "id": "backend", "label": "Backend",
      "members": ["api", "db"],
      "x": 48, "y": 48, "w": 528, "h": 96 }
  ]
}
```

The `.arch.d2` file is the canonical source of truth for topology (nodes,
shapes, edges, labels, edge styles). The `.arch.layout.json` sidecar owns
node positions and sizes, area definitions and membership, the grid pitch,
and which side (N/S/E/W) each edge endpoint anchors to.

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
  `.arch.d2` plus `.arch.layout.json` fixture.
- **M2** — Editor shell: dual-pane UI, CodeMirror with D2 highlighting,
  node drag with grid snap, edge anchor-side picker, areas, undo/redo, and
  open/save `.arch.zip`.
- **M3** — Shape library complete (cylinder, cloud, person, queue,
  document, page), edge label placement, dashed/dotted styles, dark mode,
  keyboard shortcuts.
- **M4** — Standalone HTML export with inlined `svg-pan-zoom`, README,
  screenshots, deploy to GitHub Pages, open-source release.

## License

MIT. See [LICENSE](./LICENSE).
