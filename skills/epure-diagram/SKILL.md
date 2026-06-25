---
name: epure-diagram
description: >-
  Create or edit a LIVE, grid-snapped architecture diagram that is tracked in THIS git repo and
  rendered in the Épure editor — a reviewable file pair (<name>.epr.d2 + <name>.epr.layout.json) that
  you edit on disk while the user watches it update in a browser. Use this WHENEVER the diagram should
  live in the repo, be diffable in a PR, or stay open and editable in Épure: "make/edit an epure
  diagram", "draw the architecture as an .epr.d2", "open this in Épure", "update the diagram file". Do
  NOT use this for a one-shot, self-contained HTML diagram with no repo footprint — for that use the
  `architecture-diagram` skill instead. This skill is for the editable, git-tracked, two-file format.
---

# epure-diagram

Épure (`epure`) is a grid-snapped, orthogonal-routed architecture-diagram editor. A diagram is a
**two-file pair** sharing a basename, both meant to be committed and reviewed:

- **`<name>.epr.d2`** — the *topology* (the source of truth): nodes, shapes, labels, edges, groups.
- **`<name>.epr.layout.json`** — the *visuals*: each node's grid position/size and per-element styling.

You edit these files directly. When the Épure server is running, every save appears instantly in the
user's browser, and any tweak they make in the UI (drag, restyle) is written back to these files for you
and git to see.

## When to use this vs `architecture-diagram`

- **`epure-diagram` (this skill):** the diagram lives in the repo as the `.epr.*` pair, is diffable in a
  PR, and/or is open in the Épure editor for live back-and-forth. Editable, persistent, git-tracked.
- **`architecture-diagram`:** a single standalone `.html` file, no repo footprint, not editable in Épure.

If the user wants to *keep working on* the diagram or have it *in the repo*, use this skill.

## Launch the live editor (idempotent, background)

Run once at the start of a diagram session. It is safe to run repeatedly — a second run for the same
file reuses the existing server:

```bash
npx epure ./docs/diagrams/<name>.epr.d2 &
```

It prints exactly one machine-readable line to stdout — parse the URL from it:

```
epure: ready url=http://127.0.0.1:52219/ reused=false
```

Open/print that URL for the user. Then edit the pair; saves sync live. (`epure <file>` seeds a starter
pair if the files don't exist yet; `epure new <file>` scaffolds without clobbering.)

## The `.epr.d2` topology (a tiny D2 subset)

```d2
# nodes: `id: "Label" { shape: ... }`. Label and block are optional.
user:    User           { shape: person }
api:     "API Service"  { shape: rectangle }   # rectangle (default), cylinder, person
db:      Postgres       { shape: cylinder }

# edges: id arrow id, optional label. Arrows: -> (forward), <- (back), <-> (both), -- (none).
user -> api: "HTTPS"
api  -> db:  "SQL"
api  -> db  { style.stroke-dash: 3 }   # only stroke-dash (→ dashed/dotted) is read from .d2

# groups (areas): an id with a block that LISTS member node ids (no `shape:`).
Backend: "Backend" {
  api
  db
}
```

Rules of thumb:
- Keep the `.epr.d2` about **topology only**: nodes, shapes, edges, labels, grouping. Put **all visual
  styling** (color, size, edge caps, anchor sides) in the layout sidecar — that's what keeps diffs clean.
- A block containing `shape:` (or other `key: value` attrs) is a **node**; a block that lists bare ids is
  an **area** (group). The area's label and membership come from here, never from the layout.
- Labels may contain simple HTML: `gateway: "<b>Traefik</b><br><small>prod</small>"`.

## The `.epr.layout.json` schema (authoritative)

All geometry is in **grid units, integers** — never pixels.

```json
{
  "gridSize": 40,
  "nodes": {
    "api": { "cx": 20, "cy": 11, "w": 4, "h": 2,
             "borderColor": "purple", "icon": "programming/framework/fastapi" }
  },
  "edges": {
    "api->db": { "color": "teal", "lineStyle": "dashed", "sourceSide": "E", "targetSide": "W" }
  },
  "areas": {
    "Backend": { "borderColor": "purple", "fillColor": "purple" }
  }
}
```

Field reference (exact — keep in sync with `src/file/layoutSchema.ts`):

- **`gridSize`** — integer ≥ 1. The pixel pitch of one grid unit (40 is a good default).
- **`nodes`** — keyed by `.epr.d2` node id. Each node:
  - **required:** `cx`, `cy` (center, integer grid units), `w`, `h` (integer grid units ≥ 1). Default size `w:4 h:2`.
  - style (all optional): `textSize` (`S|M|L|XL`), `textColor` & `borderColor` (palette), `fillColor`
    (palette + `transparent`,`white`), `borderStyle` (`solid|dashed|dotted`), `shape`
    (`rectangle|cylinder|person`, overrides the `.d2`), `icon` (catalog id string, e.g.
    `"aws/compute/lambda"`), `iconPosition` (`corner|top`).
- **`edges`** — keyed by **`"src->tgt"`** (the node-id pair). Optional: `color` (palette), `lineStyle`
  (`solid|dashed|dotted`), `width` (`S|M|L|XL`), `startCap`/`endCap` (`none|arrow|dot|diamond`),
  `sourceSide`/`targetSide` (`N|S|E|W`). Edge geometry is auto-routed; sides are hints.
- **`areas`** — keyed by area id from the `.epr.d2`. **Style only**: `borderColor`, `borderStyle`,
  `fillColor`. The area's box is computed from its members' positions — do NOT put `x/y/w/h/members`
  here (membership lives in the `.d2`).

**Palette colors:** `black gray red orange yellow green teal blue purple pink` (fills additionally allow
`transparent white`).

A node present in the `.d2` but missing from `nodes` still renders — Épure auto-places it at `w:4 h:2`.
So you can append a node to the `.epr.d2` alone and it appears immediately; add a `nodes` entry only when
you want to control its position.

## Conventions for good diagrams

- **Left-to-right flow:** users/entry on the left (low `cx`), data stores/leaves on the right.
- **Coarse grid + spacing:** leave 2–3 grid units between node *edges* so orthogonal routes have lanes.
- **Default node size `w:4 h:2`** unless a label needs more.
- **Color by category** (e.g. all data stores `teal`, all services `purple`) via `borderColor`, and tint
  groups with a matching `areas` `fillColor`. See `fixtures/system.epr.*` as the canonical example.

## Seeing the diagram (render a PNG)

To *look at* the diagram yourself — to check layout, overlaps, balance, or to
discuss visuals with the user — render it to a PNG and open that image. No
browser needed; the output is always fit to the diagram's content:

```bash
npx epure export ./docs/diagrams/<name>.epr.d2 -o /tmp/<name>.png   # prints the path on stdout
```

Then view `/tmp/<name>.png`. Use this after edits to verify the result actually
looks right, and whenever the user asks a visual question ("is it too cramped?",
"do the groups read clearly?"). `--scale 2` (default) is crisp; `--scale 1` is
lighter.

## Guardrails — run before finishing

```bash
npx epure validate ./docs/diagrams/<name>.epr.d2   # parse + schema + cross-file ref checks; non-zero on error
npx epure fmt ./docs/diagrams/<name>.epr.d2        # canonicalize the layout JSON so diffs stay minimal
```

`validate` confirms every `nodes`/`edges`/`areas` key in the layout references a real node/edge/area in
the `.d2`. `fmt` writes the layout in the same canonical form the editor uses, so UI edits and your edits
produce identical bytes.

## Parallel-edge caveat

Edge styles are keyed by `"src->tgt"`, so **two edges between the same pair share one style entry.** If
you need two visually distinct links between the same nodes, that's a known limitation — they will render
with the same color/lineStyle.

## Comments — addressing the user's review notes

The user can drop pins on the diagram in the Épure UI; each is a review note saved to a third sidecar,
**`<name>.epr.comments.json`**, synced live by the bridge. When the user says "address my comments" (or
clicks **Send to Claude** in the editor):

1. `Read` `<name>.epr.comments.json`. Each entry: `{ id, body, status, target: { ref?, x, y } }` —
   `ref` is the node id / `src->tgt` / area id the note is attached to (absent = free-floating); `body`
   is what the user wants changed.
2. For each `status:"open"` comment, edit the `.epr.d2` / `.epr.layout.json` pair to satisfy it.
3. Write the comments file back with that comment's `status` set to `"resolved"` (keep everything else
   byte-identical; `epure fmt` isn't needed for comments — preserve the structure). The pin turns green
   in the user's editor instantly.

Resolve only what you actually addressed; leave the rest `open`. It's plain files-as-API — no extra
tooling, and `epure export` lets you check the result visually before reporting back.
