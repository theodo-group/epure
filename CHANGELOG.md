# Changelog

## Unreleased

### New

- **Edit and align group titles.** Double-click a group's title (or its frame) to edit it in place;
  Enter saves, Escape cancels, and an empty title removes it. The style panel's Title row puts the
  title on the left, center or right (`labelAlign` in the layout file).

### Improved

- **Group titles stay inside their frame.** A group whose title is wider than its contents grows to
  fit it, without growing over nearby boxes.
- **Titles are centered by default.** Existing diagrams show their group titles centered, and a few
  edges route differently. Set `labelAlign: "left"` on an area to keep the old placement.

## 0.7.0 — 2026-10-14

### New

- **Format and Wrap in the code pane.** Format rewrites the D2 source in one consistent style
  (⇧⌥F). Wrap turns line wrapping on or off.
- **Open reads more files.** Open an Épure-exported PNG (the diagram is embedded in the image), or
  pick an `.epr.d2` file together with its `.epr.layout.json`.

### Improved

- **Clearer syntax errors.** Messages say what's wrong in plain words, for example
  ``Expected `}` to close the `web` block``, instead of a list of tokens the parser was
  "expecting".
- **Edges no longer cut through an area's title.** Edges leaving the top row of an area now go
  around its title instead of through it. A few edges in existing diagrams route differently.
  Faces you pinned are never moved.
- **Smaller install.** 4 runtime dependencies, down from 6.

### Fixed

- Error line numbers are correct in files with Windows line endings (CRLF).
- Dragging an edge's label no longer re-routes the edge.
- While the editor and the file on disk conflict, nothing is written to disk until you resolve the
  conflict. Changes made on disk in the meantime are applied once you do.

### Under the hood

- A hand-written parser replaces chevrotain. The formatter shares its lexer and syntax tree.
- The router is split into one module per stage (faces, anchors, libavoid, refine, snap,
  fallback, labels). Ids and default sizes are each defined in one place.
- Épure now does itself what used to need a library: the code/canvas split, pan and zoom in the
  HTML export, and serving the editor's files (react-resizable-panels, svg-pan-zoom and sirv
  removed).
- The build uses tsdown (replacing tsup and esbuild) and TypeScript 7.
- The tests run under Node and use a fake clock instead of fixed waits. New tests cover the editing
  actions, the server's checks and opening PNGs.

### By the numbers

|                                                   | 0.5.0              | 0.6.0              | 0.7.0                           |
| ------------------------------------------------- | ------------------ | ------------------ | ------------------------------- |
| Runtime dependencies (`package.json`)             | 22                 | 6                  | **4**                           |
| Packages pulled in by `npm i @theodo-group/epure` | 46                 | 21                 | **11**                          |
| Installed size of those dependencies              | 34.6 MB            | 16.0 MB            | **13.8 MB** (−60 % since 0.5.0) |
| Hosted editor JS (gzip)                           | 420 KB             | 429 KB             | **385 KB** (−10 %)              |
| Full build (`build:all`)                          | 7.0 s              | 5.9 s              | **2.9 s** (−51 %)               |
| Typecheck                                         | 1.6 s              | 1.6 s              | **0.5 s**                       |
| Test suite                                        | 291 tests in 5.6 s | 291 tests in 5.0 s | **585 tests in 2.2 s**          |

Medians of three runs on one machine; read the times as relative. The library and CLI bundles grew
slightly because they now contain the parser and file server that chevrotain and sirv used to
provide (`render`: 22.0 → 26.3 KB gzip, CLI: 180 → 187 KB gzip). The package itself is unchanged
at 8.3 MB, mostly icons.

### Upgrading

The `.epr.d2` / `.epr.layout.json` format is unchanged. Code or tests that match parser error text
need updating.

## 0.6.0 — 2026-10-13

- **Requires Node 22 or later.**
- Dependencies upgraded (Vite 8, Vitest 5, TypeScript 6, React 19 for the editor).
- Runtime dependencies cut from 22 to 6: unused CodeMirror packages removed, editor-only packages
  moved to dev dependencies.
- Biome replaces ESLint and Prettier.
