# Épure ↔ Claude Code: live file-bridge integration

> **Naming convention:** human-facing text (UI title, README, docs) uses **Épure** (with accent);
> everything machine-facing (npm package, CLI binary, code identifiers, endpoints, env vars, file
> extension) uses ASCII **`epure`** — nothing breaks on encoding. The project is being renamed from
> `archgrid` → `epure` as part of this work (Phase R).

## Context

`epure` (née `archgrid`) is today a **pure static SPA** (React + Vite + Zustand) that edits architecture
diagrams. A diagram is a two-file pair — `<name>.epr.d2` (semantic topology) + `<name>.epr.layout.json`
(grid positions/styles) — but the app today **persists only to `localStorage`** (the zip path is
import-only; there is no save/export-to-zip code — export is PNG/HTML). **Nothing reads or writes plain
diagram files inside a working repo, and there is no external integration of any kind.**

The goal is to make Épure delightful to drive **from Claude Code (CC)**:

1. CC creates/edits the `.epr.d2` + `.epr.layout.json` pair **inside the repo the user is working in**.
2. The Épure UI is **open and live** — CC's file edits appear instantly; the user's UI tweaks
   (drag/restyle) flow back to those files so CC and git see them.
3. The user discusses with CC while watching the diagram evolve.

And to do it in an interaction mode that lets a **future "claude design" feature** drop in with no
redesign: the user drops comments/pins on the diagram in the UI, and CC later reads them and fixes
the diagram. (Designed here, **not** built.)

**Locked decisions (chosen by the user):**
- **Name: Épure / `epure`.** Renaming `archgrid` → `epure` **everywhere**, including the GitHub repo,
  git remote, and Conductor workspace (branch stays `tianjin`). See Phase R.
- **File extension: `.epr.*`** — `<name>.epr.d2` + `<name>.epr.layout.json` (+ `.epr.comments.json`,
  `.epr.zip`). Replaces the old `.arch.*`.
- **Local bridge process** — an `epure <file>` CLI that serves the UI, watches the file pair, and
  live-syncs both directions over WebSocket. (Chosen over a browser-only File System Access approach.)
- **Two-file pair** in the repo (chosen over a single combined file).

This plan was hardened by a 3-angle design pass + a 26-finding adversarial critique, then a second
`/critique` pass (1 blocker-premise + several correctness fixes, all folded in). It **cuts the
daemon/discovery/multiplex/optimistic-concurrency machinery** and keeps a deliberately small, correct core.

> **On the "why a server at all?" critique:** two reviewers argued the File System Access API could do
> this with zero server. The user explicitly weighed that fork and chose the bridge (FSA is Chromium-only,
> needs a per-session folder-grant click, can't be launched cleanly by CC, and is a worse home for the
> comment round-trip). We honor that — but adopt the *spirit* of the simplicity critique: the server is a
> single, minimal, short-lived process, not a daemon.

---

## Phase R — Rename `archgrid` → Épure (land this FIRST, as its own commit/PR)

Do the rename before the feature work so all new code (CLI `epure`, `/__epure/*`, `EPURE_FILE`, the
`epure-diagram` skill) is written with the final name and the feature diff stays clean. It's mechanical
and low-risk. The surface was enumerated by grep; the `__archgrid`/`ARCHGRID_FILE` strings found live only
in the gitignored `.context/` design doc, **not** in shipping code.

**In-repo (code):**
- `package.json` — `"name": "archgrid"` → `"epure"` (the `"bin": { "epure": ... }` entry is added in Phase 1).
- **CSS / SVG class & id prefixes** `archgrid` / `ag-` / `__archgrid` → `epure` / `ep-` / `__epure`, across
  `index.html`, `src/main.tsx`, `src/App.css`, `src/editor/CodeMirrorPane.tsx`, `src/editor/Header.tsx`,
  `src/renderer/Grid.tsx`, `src/renderer/dragState.ts`, `src/export/standalone-html.ts`. Keep prefixes
  internally consistent (the standalone-HTML export bakes class names into output).
- **`localStorage` keys** in `src/file/localStore.ts`: `archgrid:doc:v1` → `epure:doc:v1`,
  `archgrid:history:v1` → `epure:history:v1`; and `App.tsx` `autoSaveId="archgrid:panels"` → `epure:panels`.
  Note: this orphans any locally-saved dev doc. Acceptable pre-release; a one-time read of the old keys as a
  fallback is optional and probably not worth it.

**In-repo (the `.epr.*` extension):**
- Replace `.arch.d2` → `.epr.d2`, `.arch.layout.json` → `.epr.layout.json`, `.arch.zip` → `.epr.zip`,
  `.arch` → `.epr` across code + docs. In `src/file/zip.ts` rename `stripArchExt` → `stripEprExt` and its
  regexes; the **inside-zip** entry names (`diagram.d2`, `layout.json`) are brand-neutral — leave them.
- Rename fixtures `fixtures/system.arch.d2` → `fixtures/system.epr.d2` and
  `fixtures/system.arch.layout.json` → `fixtures/system.epr.layout.json`; update the `?raw` imports in
  `src/App.tsx` (`../fixtures/system.arch.d2?raw`, `…layout.json?raw`).

**Docs / UI title:**
- `index.html` `<title>`, `README.md`, `PLAN.md` → **Épure** (and fix the stale schema while there — see
  Phase 3). The editor tab labels (`diagram.d2`, etc.) are cosmetic.

**Project identity (user opted in):**
- `gh repo rename epure` (renames the GitHub repo; GitHub auto-redirects the old URL) **and**
  `git remote set-url origin <new-url>`. *Outward-facing — confirm before executing.*
- Rename the **Conductor project** to `epure` via Conductor (the on-disk workspace path
  `…/workspaces/archgrid/tianjin` may only change on a fresh workspace — not blocking; the dir name is
  cosmetic). **Do not rename the `tianjin` branch.**

Gate Phase R on `pnpm typecheck && pnpm lint && pnpm test` (no behavior change expected) before moving on.

---

## Phase 0 — Prerequisite fix: a `.d2`-only diagram must render (BLOCKER)

**Problem (verified):** `route()` (`src/layout/elk.ts:138`) throws `Missing layout for node` when a node
exists in the `.d2` but has no layout entry. `reroute()` (`src/store/diagramStore.ts:385`) catches, sets
`routed: null` → **blank canvas**. The single most common CC action — append a node to the `.d2` without
touching the layout — currently breaks the diagram. Also fixes a latent standalone bug today.

**Fix (in-memory normalization, no disk mutation):**
- Add `normalizeForRoute(diagram, layout): LayoutSidecar` (new `src/layout/normalize.ts`). For every diagram
  node lacking a `layout.nodes[id]` entry, synthesize a **deterministic** entry sized `{w: 4, h: 2}` — the
  chosen canonical default (the store uses `w:4 h:2` in `moveNode` at `diagramStore.ts:142`; note
  `setNodeSize:222` diverges with `{cx:0,cy:0,w,h}` — we standardize on `w:4 h:2` and SKILL/docs follow).
  **All math is in grid units, never pixels:** read `layout.gridSize`, compute the placed nodes' grid-unit
  bounding box (max `cy + h/2`), start unplaced nodes two grid units below it, lay them left-to-right at a
  fixed grid-unit column stride, wrapping at a sensible width; if none placed, start at `{cx: 4, cy: 2}`.
  Deterministic order (AST order) so the same `.d2` always yields the same placement.
- Call it inside `reroute()` (`diagramStore.ts:385`) on the layout passed to `route()` — **do not write the
  synthesized entries into `store.layout`.** Store layout stays byte-faithful to disk; the canvas just shows
  auto-placed nodes. (Key fix for the echo-loop trap below: because synthesized positions never enter
  `store.layout`, the outbound persist path has nothing extra to send — they *cannot* bounce back to disk.
  Positions persist only when the user actually drags the node — a real gesture.)
- Replace the `throw` at `elk.ts:139` with a defensive fallback through the same default size and the real
  two-arg signature — `pos ??= toPixelRect({cx:0,cy:0,w:4,h:2}, gridSize)` (`toPixelRect(node, gridSize)`,
  `elk.ts:118`) — so it lands in the same coordinate space and `route()` can never blank the canvas.
- Tests: a document with `.d2` nodes and an **empty** layout routes, renders, and is stable across reruns.

Shippable on its own and independently valuable.

---

## Phase 1 — The bridge (server + CLI)

### 1a. `bridge-core` (transport-agnostic) — `server/core/`
One module both hosts share. Responsibilities:
- **Resolve** the pair from any of `<name>.epr.d2` / `.epr.layout.json` / bare stem.
- **Watch** both files with **chokidar** + `awaitWriteFinish` (coalesces editors' temp-write+rename; the
  single most important correctness lever for half-written files).
- **Validate before emitting:** run `parse()` (the Chevrotain parser) for `.d2` and the existing
  `validateLayoutJson` (`src/file/layoutSchema.ts`, already DOM-free) for layout. If a file is mid-write /
  invalid, emit `{kind, valid:false, error}` — **never** push garbage that would blank the canvas.
- **Per-kind frames** (see protocol). A diagram = a set of sidecar files keyed by `basename`, each tagged
  with a `kind` (`d2 | layout | comments`). This structural decision makes the future comments file additive
  with **zero new message types**.
- **Echo suppression:** before the server writes a file, record its hash; drop the chokidar event whose hash
  matches. Crucially — **hash by semantics, not raw bytes, for `layout`**: compare `canonical(parse(disk))`
  vs `canonical(parse(lastWritten))`, where `canonical` is the **single shared serializer** in 1a-bis. Both
  sides MUST canonicalize before hashing or the loop returns. For `.d2` use raw-byte hash (it *is* the human
  source). This kills the oscillation where CC's formatting differs from the UI's `JSON.stringify`.
- **1a-bis — the canonical layout serializer (load-bearing, must be a fixed point).** One function used by
  the bridge write path, the UI outbound write, and `epure fmt`. It pins: a **fixed key order** (`gridSize`;
  then `nodes` emitting `cx,cy,w,h` then style fields in a fixed order; then `edges`; then `areas`), **omit
  absent optionals** (never emit `null`), integers as integers (the schema constrains `cx/cy/w/h/gridSize` to
  integers, so no float drift), trailing newline. Invariant to test:
  `canonical(parse(canonical(x))) === canonical(x)`. Without this fixed-point guarantee the semantic
  echo-hash silently re-enables the loop.
- **Coherent pair write** on inbound apply (note: true cross-file atomicity is impossible — `rename(2)` is
  atomic per file, not across two). Write both temps, then `rename` back-to-back to shrink the window. We do
  **not** rely on atomicity for correctness: the read side coalesces and reads **both** files on any change,
  and Phase 0 tolerates "node in `.d2`, missing in layout," so every intermediate state is non-corrupting —
  worst case a transient auto-placed node or a harmless orphan layout key (ignored, since `route()` iterates
  `diagram.nodes`). **Canonicalize** layout on write so disk bytes converge regardless of origin.

### 1b. Two thin hosts
- **Standalone Node server** (`server/standalone.ts`) — serves built `dist/` via **sirv** + a **ws**
  WebSocket server. Ships via `npx`.
- **Vite plugin** (`server/vite-plugin.ts`) — for `pnpm dev` while developing Épure; reuses Vite's built-in
  `server.ws` (no extra dep), reads `EPURE_FILE`.

### 1c. CLI — `epure <file>` (+ `new`, `validate`, `fmt`, `skill install`)
Deliberately **no daemon, no discovery file, no lockfile, no multiplex** (all cut per critique).
- Resolve pair; create from a seed if missing (`new` refuses to clobber existing files).
- **One server per diagram**, on a **deterministic port** = `49152 + (hash(realpath(pair)) mod 16384)` (a
  documented hash over the IANA ephemeral range 49152–65535). Idempotency without a lockfile: try to bind
  that port; on `EADDRINUSE`, probe `GET /__epure/health` (returns the served pair's `realpath`) — if it
  matches, **reuse it** (print the URL, exit 0, no second server); otherwise it's a **hash collision with a
  different diagram** → fall back to an OS-assigned port (`listen(0)`) and log that this diagram's URL won't
  be stable across sessions. The OS port-bind *is* the lock → race-safe when CC fires the command twice. (One
  port per diagram also sidesteps the unsolved "focus the right tab" problem — each diagram has its own URL/tab.)
- **Browser open** on first start only, **best-effort and non-fatal** (print URL on any failure). No
  double-fork/daemonization (cross-platform footgun — cut).
- **Foreground process**; CC backgrounds it. Print exactly **one machine-readable line** to stdout
  (`epure: ready url=… reused=…`, plus `--json`); route all other logs to stderr so CC can parse the URL.
- Set a per-doc `document.title` (`<basename> — Épure`) so tabs are distinguishable.

### 1d. Security
Bind **127.0.0.1 only**; **Origin/Host check** on the WS upgrade and `/__epure/*` (defeats DNS-rebinding);
**per-session token** injected into the served `index.html` and required on `hello`; writes confined to the
resolved pair's directory (the apply frame carries a `kind` **enum**, never a path).

### 1e. Distribution / dependency hygiene
The three server deps (`chokidar`, `ws`, `sirv`) must **never** enter the SPA bundle — the GitHub-Pages
build stays a pure static SPA. Isolate the CLI/server (separate `package.json`/entry under `server/`, or a
dedicated `epure-cli` package) so the editor tree keeps zero runtime server deps. End users run
`npx epure ./docs/diagrams/x.epr.d2` (zero-install) or `npm i -g epure`.

### Protocol (per-kind, coherent-write capable)
```
C→S  hello   { protocol, token, doc /*basename*/ }
S→C  hydrate { doc, files: [{ kind, content|null, valid, error? }] }     // first load
S→C  fileChanged { doc, kind, content, valid, error? }                   // disk changed (CC wrote)
C→S  apply   { doc, files: [{ kind, content }] }                         // UI edits — coherent pair
S→C  applied { doc, kinds } | rejected { doc, reason:'invalid', error? }
```
`config`: `GET /__epure/config` → `{ bridge:true, version, wsUrl, file }` (minimal — no speculative
`features[]` until a gated feature actually lands).

---

## Phase 2 — Client integration (`src/bridge/`)

- **`config.ts`** — `detectBridge(): Promise<BridgeConfig|null>` probes `GET /__epure/config` at boot
  (runtime, **not** a build flag — the same bundle ships to Pages *and* the local server). 404/HTML → null.
- **`BridgeClient.ts`** — framework-agnostic pure TS (WebSocket + reconnect/backoff + **per-kind**
  last-applied-hash + send). Unit-testable without a DOM.
- **`useBridge.ts`** — React adapter wiring `BridgeClient` to the store and to App effects.

**Bootstrap precedence** (rework `App.tsx:141`): bridge present → ignore localStorage, hydrate from the WS;
bridge absent → the verbatim current `localStorage → fixture` path. In bridge mode localStorage is a
**write-only** offline cache (never read — avoids resurrecting a different repo's stale doc).

**Inbound (disk → UI):**
- **First** `hydrate` → `loadDocument(source, layout)` (`diagramStore.ts:400`) — correct fresh baseline (clears undo).
- **Subsequent** per-kind `fileChanged` → `setSource` / `setLayout` with **zundo temporal paused** around the
  apply (no new undo entry, no `temporal.clear()`). Avoids (a) wiping the user's undo stack on every CC write
  and (c) a reconnect clobbering offline edits; reconnect re-hydrate uses this paused-apply path, **not**
  `loadDocument` (so a transient socket drop never wipes history).
  **Important (critique fix):** pausing alone does *not* close an already-open burst — the module-level
  `bursting`/`timeout` state in the `handleSet` closure (`diagramStore.ts:431-444`) survives the pause, so a
  local edit landing <350 ms after a remote apply would still fuse into the pre-remote undo step. The
  remote-apply path must therefore **also reset the burst** (clear `timeout`, set `bursting=false`) so the
  user's next local edit opens a fresh snapshot. Expose a small `flushBurst()` from the store's temporal
  setup; cover it with a test (remote apply → immediate local drag → drag is independently undoable).
  *(Tradeoff: "Cmd-Z to undo Claude's change" is out for v1 — recover via CC or git. Tracking remote edits in
  history is a v2 option at the same chokepoint.)*

**Outbound (UI → disk)** — adapt the `App.tsx:164` persist effect:
- In bridge mode, additionally send **one coherent `apply` envelope** with only the dirty kinds
  (`files:[{kind:'d2',…},{kind:'layout',…}]`). Keep the localStorage write as fallback.
- **Validity gate:** never send `d2` unless `parse(source).ok`; never send `layout` unless
  `validateLayoutJson` passes. This keeps last-good bytes on disk while the user mid-types an invalid edit —
  but the editor buffer and disk then silently diverge. **Surface that divergence:** when an outbound write is
  withheld, show an "unsaved — invalid syntax, not written to disk" state on the status pill (clear it once
  the buffer parses and the write lands), so neither the user nor CC thinks disk reflects the buffer.
- **Re-entrancy guard:** suppress the outbound send when the change originated from a remote apply, keyed on
  **per-kind content-hash identity** of what is actually in `store.{source,layout}`. (Because Phase-0
  normalization is *not* written into `store.layout`, a `.d2`-only CC write produces no layout change at all —
  nothing on the layout kind to bounce. The guard exists for the symmetric case: a remote apply that *does*
  change `layout` must not echo straight back out.)

**"Local interaction in progress" guard (single mechanism, covers two HIGH findings):** while a pointer drag
is active **or** a CodeMirror tab is focused with edit activity in the last ~1 s, **defer** inbound applies
and show a non-blocking "disk changed — reload" pill; reconcile on pointer-up / next quiet window. Prevents
both "nodes yanked from under the cursor" and "in-progress editor text clobbered." Two surfaces, two
"dirty" detections:
  - **layout tab** — local `layoutText` mirror (`App.tsx:109-130`) can diverge from the store (invalid text
    never reaches `setLayout`); its force-resync effect must respect this guard.
  - **d2 tab** — binds `value={source}` directly to the store (`App.tsx:294`), so there is *no* separate
    buffer; a remote `fileChanged{d2}` would replace editor content mid-keystroke. Detect "dirty" via
    **editor focus + a recent-keystroke timestamp** and defer the inbound `setSource` the same way.

**Status pill** (`src/bridge/BridgeStatus.tsx`, in `Footer`): standalone(hidden) / connecting / connected
(shows filename) / disconnected (still editable) / transient "reloaded from disk" flash on remote apply — so
the user *sees* CC's edits land and trusts the link. Purely presentational; never blocks input.

**Standalone fallback:** when `detectBridge()` → null, behavior is byte-for-byte today's. The Phase-0
normalization is the only always-on change and is a no-op when every node already has a layout entry.

---

## Phase 3 — Claude Code ergonomics

- **`skills/epure-diagram/SKILL.md`** (shipped in-repo as source of truth; `epure skill install` copies it to
  `~/.claude/skills/` so CC discovers it globally and it never drifts from the installed schema). Teaches the
  **real** schema (from `layoutSchema.ts`/fixtures — `cx`/`cy` grid units, `areas` as a style-only keyed
  Record), the `.d2` DSL subset, conventions (left-to-right, default `w:4 h:2`, coarse grid for routing
  lanes), the launch one-liner (idempotent, background, parse the `url=`), and the `epure validate`/`fmt`
  guardrails. Include the **parallel-edge caveat** (edge styles keyed by `src->tgt`, shared across parallel
  edges) and a forward-looking comments paragraph.
  - **Disambiguate from the existing `architecture-diagram` (one-shot HTML) skill at the *description* level**
    — skill selection happens on the description before the body is read. Lead with "use ONLY for a
    LIVE-EDITABLE diagram tracked in this git repo / opened in the Épure editor; for standalone HTML use
    `architecture-diagram`," and add the inverse negative-trigger to that existing skill
    (`~/.claude/skills/architecture-diagram/SKILL.md` — the user's own skill, in scope to edit).
- **`epure validate <fileOrDir>`** — reuses `validateLayoutJson` + `parse()`, **plus cross-file checks**
  (every layout `nodes`/`edges` key references a real `.d2` node/edge; area ids match). Emits `file:line:col`
  errors, non-zero exit. The bridge runs the same validation on every watch event.
- **`epure fmt <file>`** — the **shared canonical serializer** (1a-bis) used by both the bridge write path
  and CC, so diffs stay minimal and disk bytes converge.
- **Fix the stale docs:** correct `README.md:29-46` and `PLAN.md` schema examples (`x/y` pixels + array
  `areas`) to the real `cx/cy` + Record form, or replace them with a pointer to
  `fixtures/system.epr.layout.json` as canonical. CI-check the SKILL's schema table against `layoutSchema.ts`.
- **`CLAUDE.md` snippet** for consuming repos: "run `epure <file>` in the background at session start
  (idempotent), then edit the pair; run `epure validate` before finishing."

---

## Future (designed, NOT built): "claude design" comments

The chosen design makes this purely additive:
- **Third sidecar `<name>.epr.comments.json`** rides the **same per-kind protocol** (`kind:'comments'`) and the
  same watcher — no new message types. Files-as-API: CC reads/writes the sidecar natively; "address my
  comments" = `Read` the file → edit the pair → set `status:'resolved'`. **No MCP needed for v1** (MCP is a
  later optional query/push accelerator that reads the *same* files, never a new source of truth).
- **Comment data model with the orphan policy baked in *now*** (free in a not-yet-shipped file, impossible to
  add cleanly later): `target` carries **both** a `ref` (node id / `src->tgt` / area id) **and** a last-known
  `{x,y}` in grid units; resolution = "use `ref` if it resolves, else render at `{x,y}` with a *target-missing*
  badge." Stable `id` + `createdAt`; comments live in a **separate store slice kept out of zundo `partialize`**
  so pins never pollute undo history.
- Forward-proofing for `.epr.zip` (critique-corrected): today `src/file/zip.ts` is **import-only**
  (`readArchZip`/soon `readEprZip` + `openWithFileSystemAccess`, no `zipSync`/save path; export is
  PNG/standalone-HTML only — the README's "persisted as a single zip" describes a save path that was never
  built). So there is nothing to forward-proof now. The actionable constraint is on *whoever later adds a zip
  export*: bundle a present `comments.json` and pass through unknown entries, so the eventual share path won't
  silently strip comments.

---

## Critical files

| Area | Files |
|------|-------|
| Rename (Phase R) | `package.json`, `index.html`, `src/main.tsx`, `src/App.css`, `src/editor/*`, `src/renderer/{Grid,dragState}.*`, `src/export/standalone-html.ts`, `src/file/{localStore,zip}.ts`, `src/App.tsx`, `fixtures/system.epr.*`, `README.md`, `PLAN.md` + `gh repo rename` / `git remote` |
| Blocker fix | `src/layout/elk.ts:138` (throw→fallback), **new** `src/layout/normalize.ts`, `src/store/diagramStore.ts:385` (`reroute` calls normalize) |
| Bridge server | **new** `server/core/`, `server/standalone.ts`, `server/vite-plugin.ts`, `bin/epure.js` |
| Client | **new** `src/bridge/{config,BridgeClient,useBridge,BridgeStatus}.ts(x)`; edit `src/App.tsx:141` (bootstrap) + `:164` (persist); guard `App.tsx:109-130` (layout-tab mirror) |
| Store | `src/store/diagramStore.ts` — paused-apply path + `flushBurst()` for remote edits |
| Reuse as-is | `src/file/layoutSchema.ts` (`validateLayoutJson`, client+server+CLI), `src/parser` (`parse`), `loadDocument`/`setSource`/`setLayout`, `fixtures/system.epr.*` (canonical schema example) |
| CC surface | **new** `skills/epure-diagram/SKILL.md`; edit `README.md`, `PLAN.md`, `~/.claude/skills/architecture-diagram/SKILL.md` |

---

## Verification

- **Phase R:** `pnpm typecheck && pnpm lint && pnpm test` green with no behavior change; `pnpm dev` loads the
  renamed `fixtures/system.epr.*`; grep confirms no stray `archgrid`/`.arch.` in shipping code.
- **Unit (Vitest):** `normalizeForRoute` (empty layout → stable grid placement); per-kind echo hashing
  (semantic layout vs raw `.d2`) incl. the canonical fixed-point invariant; coherent pair write; outbound
  validity gate (invalid buffer not written); `flushBurst` (remote apply → immediate drag → independently
  undoable); `epure validate` cross-file checks.
- **Concurrency:** run `epure <file>` 5× concurrently → assert exactly one listening port (port-bind race).
- **End-to-end (manual + `chrome-devtools` MCP to drive/screenshot):** `epure fixtures/system.epr.d2`
  → (1) CC appends a node to the `.d2` only → canvas updates live, node auto-placed (Phase-0 path);
  (2) drag a node in the UI → `layout.json` updates on disk; (3) CC writes malformed JSON → canvas keeps
  last-good + error badge (no blank); (4) restart the server → UI reconnects, undo history intact;
  (5) edit while the layout tab is focused + dirty → remote change defers behind the reload pill, no silent loss.
- **Gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`. Confirm the **Pages build carries zero server deps**
  (grep the bundle / check the dist graph).

## Scope note
v1 = Phase R + Phases 0–3. Explicitly **deferred to v2** (per the "too big" critique): daemon/tab reuse across
diagrams, `rev`/`baseRev` optimistic concurrency + Reapply/Discard merge UI, a separate pair-coalescing timer,
per-gesture inbound reconciliation, `features[]` capability gating, and the comments UI itself. For an even
smaller first cut, **Phase R + Phase 0 + a read-only live-reload bridge** (file→UI only, no write-back) is a
coherent slice — but write-back is needed for the editor to feel whole, so it's in v1.

---

## Provenance

This plan was produced via plan mode and hardened by: a 3-angle design workflow (bridge server / client
integration / CC ergonomics), a 26-finding adversarial critique across 4 lenses, and a second `/critique`
pass (Opus reviewer). All correctness fixes from those passes are folded in above. Status: **awaiting
implementation** (rename first, then Phases 0–3).
