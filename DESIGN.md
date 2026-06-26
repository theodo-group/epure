---
name: Épure
description: A precise, quiet drafting instrument for grid-snapped architecture diagrams that live in your repo.
colors:
  # Chrome neutrals — warm stone ramp (hex, exactly as written in src/App.css).
  canvas-bg: "#ecebe7"
  app-surface: "#fafaf9"
  surface: "#ffffff"
  border: "#ebe9e6"
  border-soft: "#d6d3d1"
  ink: "#1c1917"
  ink-tertiary: "#57534e"
  ink-muted: "#78716c"
  ink-subtle: "#a8a29e"
  # Editor pane — the dark drafting slab.
  editor-bg: "#18181b"
  editor-tabs: "#0f0f12"
  editor-divider: "#27272a"
  editor-text: "#d4d4d8"
  # Primary accent — OKLCH, exactly as written in src/App.css (the one blue voice).
  accent: "oklch(0.55 0.16 250)"
  accent-deep: "oklch(0.4 0.16 250)"
  accent-bg: "oklch(0.96 0.04 250)"
  accent-border: "oklch(0.85 0.06 250)"
  # Semantic
  warn: "oklch(0.65 0.18 50)"
  ok: "oklch(0.62 0.14 145)"
  danger: "#b91c1c"
  # Diagram-content palette — Excalidraw-style hues authored INTO diagrams
  # (Tailwind 500 strokes; pale 50 fills live in the sidecar). Not chrome.
  diagram-red: "#ef4444"
  diagram-orange: "#f97316"
  diagram-yellow: "#eab308"
  diagram-green: "#22c55e"
  diagram-teal: "#14b8a6"
  diagram-blue: "#3b82f6"
  diagram-purple: "#a855f7"
  diagram-pink: "#ec4899"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.2px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.3px"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "6px"
  md: "7px"
  lg: "9px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.app-surface}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "#292524"
    textColor: "{colors.app-surface}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost-hover:
    backgroundColor: "#f5f5f4"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  tool:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    size: "32px"
  tool-active:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-deep}"
    rounded: "{rounded.sm}"
    size: "32px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "12px"
  input:
    backgroundColor: "{colors.app-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "30px"
---

# Design System: Épure

## 1. Overview

**Creative North Star: "The Drafting Table"**

Épure is a precise instrument, not an app. The whole surface behaves like a
drafting table under good light: a flat warm-stone field, a snapping grid, exact
orthogonal lines, and a small set of mechanical controls that sit *on* the work
rather than around it. Every value is deliberate — 1px hairlines, 11px labels,
32px tool cells — because precision is the brand. When the diagram is the only
thing you notice, the design has done its job.

The system is built from two clearly separated worlds. The **chrome** is a quiet,
light, warm-neutral instrument: a stone ramp from `#ecebe7` canvas up to pure
`#ffffff` floating surfaces, a single blue accent that appears only to mark the
active tool or focused field, and the dark code-editor slab (`#18181b`) that
anchors the left pane like a slate. The **diagram content** is a separate, vivid
ten-hue palette (Excalidraw-style Tailwind 500 strokes over pale 50 fills) that
the user authors *into* the drawing — saturated on purpose, so the work pops
against the muted instrument that holds it. These two palettes never trade roles.

This system explicitly rejects the generic AI-SaaS look: no gradient heroes, no
glassmorphism, no decorative blur, no endless identical card grids, no big-number
metric templates. It also rejects the two adjacent traps — the playful,
hand-sketched Excalidraw register (Épure is *exact*, not loose) and heavy
enterprise CAD chrome (ribbons, stacked toolbars, modal soup). Density without
clutter; restraint without blandness.

**Key Characteristics:**
- Two-world color: muted warm-stone chrome holding a vivid diagram palette.
- One accent (blue) used only for active/focused state — never decoration.
- Hairline-and-tonal depth; soft shadow reserved for UI that truly floats over the canvas.
- Monospace for anything mechanical (coordinates, keys, code, file names).
- Compact, exact metrics: 1px rules, 10–13px type, 28–44px control heights.

## 2. Colors

A muted warm-stone instrument that frames a deliberately vivid diagram palette; one cool-blue accent is the only chromatic voice in the chrome itself.

### Primary
- **Drafting Blue** (`oklch(0.55 0.16 250)`): the single accent. Active tool border, focused input ring, selected-segment text, resize-handle hover. Paired with **Drafting Blue Deep** (`oklch(0.4 0.16 250)`) for accent text/icons and **Drafting Blue Wash** (`oklch(0.96 0.04 250)`) as the pale active-state fill behind tools and chips, bordered by **Drafting Blue Edge** (`oklch(0.85 0.06 250)`).

### Secondary
- **Slate Ink** (`#1c1917`): doubles as a "primary action" surface — the primary button is near-black stone, not blue. Hover lifts to `#292524`. This keeps the blue accent rare.

### Tertiary
- **Diagram Hues** (`#ef4444` red, `#f97316` orange, `#eab308` yellow, `#22c55e` green, `#14b8a6` teal, `#3b82f6` blue, `#a855f7` purple, `#ec4899` pink): the content palette the user paints onto nodes, edges, and areas. Tailwind 500 strokes over pale Tailwind 50 fills (`#fef2f2`, `#fff7ed`, …). These belong to the drawing, never to the UI.
- **Warn Amber** (`oklch(0.65 0.18 50)`) and **OK Green** (`oklch(0.62 0.14 145)`): status only (validation, sync). **Error Red** (`#b91c1c`): footer parse/sync errors.

### Neutral
- **Canvas Stone** (`#ecebe7`): the outermost body field, behind the app shell.
- **App Surface** (`#fafaf9`): the app shell and the diagram canvas backdrop — the drafting field.
- **Floating Surface** (`#ffffff`): every surface that lifts — header, panels, palettes, menus, zoom dock.
- **Hairline** (`#ebe9e6`) / **Hairline Strong** (`#d6d3d1`): the 1px borders that do the structural separating.
- **Ink** (`#1c1917`) → **Ink Tertiary** (`#57534e`) → **Ink Muted** (`#78716c`) → **Ink Subtle** (`#a8a29e`): the text ramp, dark to light, for primary copy, section heads, secondary labels, and the faintest hints/keycaps.
- **Editor Slab** (`#18181b`, tabs `#0f0f12`, divider `#27272a`, text `#d4d4d8`): the dark CodeMirror pane — a deliberate slate counterweight to the light canvas.

### Named Rules
**The One Blue Rule.** The blue accent appears *only* to signal state — an active tool, a focused field, a hovered resize handle, a selected segment. It is never a fill for emphasis, never a gradient, never decoration. Its rarity is what makes "active" legible at a glance.

**The Two-Worlds Rule.** Chrome colors (stone + one blue) and diagram colors (the ten saturated hues) never swap jobs. UI never borrows a diagram hue for emphasis; a node never gets painted in `--ep-accent`. The muted instrument exists so the vivid work stands out.

## 3. Typography

**UI Font:** system sans (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui`)
**Mono Font:** JetBrains Mono (with `ui-monospace, Menlo` fallback)
**Diagram Fonts:** user-selectable per diagram — Inter (default), Poppins, System, Helvetica, Georgia (serif), Mono.

**Character:** The chrome speaks in the OS's own native sans so it feels like part of the desktop, never a website. JetBrains Mono carries everything *mechanical* — coordinates, zoom readouts, keycaps, file names, tab labels, the code itself — so numbers and structure read as precise and tabular. The contrast axis is sans vs. mono, not two sans that fight.

### Hierarchy
- **Title** (600, 11px, capitalize): style-panel section heads. Small and quiet — it labels, it doesn't announce.
- **Body** (400, 13px, 1.45): the base UI size. Menu items, buttons, hints. Compact by design; this is a dense tool.
- **Label** (600, 10px, +0.3–0.5px tracking, often UPPERCASE): the style-panel field labels (`FILL`, `STROKE`, `SIZE`). The uppercase tracked micro-label is intentional *here* as a control-surface convention — it is not a section eyebrow.
- **Mono** (400, 10–12px): JetBrains Mono for the footer, zoom readout, keycaps, tab names, segmented-control values, and the CodeMirror editor. Anything that is a coordinate, a key, or code.

### Named Rules
**The Mono-for-Mechanism Rule.** If a value is a coordinate, a percentage, a keyboard shortcut, a file path, or code, it is set in JetBrains Mono. Prose and labels are sans. The font itself tells you whether a thing is *machine* or *language*.

## 4. Elevation

Depth is **layered** and built primarily from tonal surface tiers and 1px hairlines, not shadow. The stack reads canvas-stone (`#ecebe7`) → app surface (`#fafaf9`) → floating white (`#ffffff`), each separated by a hairline border. Shadow is added *only* to elements that genuinely float over the canvas — the tool palette, style panel, zoom dock, menus, icon popover — where a soft ambient shadow sells the lift. Chrome that's docked (header, footer, tab bar) stays flat and leans on its border instead.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 4px 16px rgba(28,25,23,0.06)`): floating-over-canvas UI — palettes, panels, pills, docks, menus, popovers. Soft, low, warm-tinted toward the stone ink.
- **App** (`box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 18px 48px rgba(28,25,23,0.10)`): the largest lift, for the app shell / full-window framing.

### Named Rules
**The Float-Earns-Shadow Rule.** A surface gets a shadow only if it floats over the canvas. Docked chrome (header, footer, tab bar, resize handle) is flat and separated by a hairline. If you reach for a shadow on a docked element, use a border instead.

## 5. Components

The control set feels **mechanical and precise** — like a CAD or pro-tool surface. Small targets, exact radii, crisp single-purpose states. No bouncy, no playful.

### Buttons
- **Shape:** softly squared, `7px` radius (`{rounded.md}`).
- **Primary:** near-black stone (`#1c1917`) with `#fafaf9` text, `6px 12px` padding, 12.5px/500. Hover lifts to `#292524`. Note: the primary action is *stone, not blue* — keeps the accent rare.
- **Ghost:** white surface, 1px hairline border, ink text. Hover fills `#f5f5f4`.
- **Icon button:** 28×28, centered glyph, otherwise ghost styling.
- **Disabled:** `opacity: 0.45`, `not-allowed` cursor. No color change.

### Tool palette (signature)
- A floating white rail (`9px` radius, Card shadow, 2px padding) of 32×32 cells.
- **Rest:** transparent, `--ep-text-muted` glyph, a tiny mono keycap pinned bottom-right.
- **Active:** Drafting Blue Wash fill + Drafting Blue Edge border + Drafting Blue Deep glyph, and the keycap shifts to blue. This is the canonical "active state" treatment reused by the grid toggle and segmented controls.

### Segmented control
- A `#f5f5f4` track with 1px hairline, `7px` radius, 2px inset. Buttons are mono, 11px, muted at rest; the active segment gets a white surface, accent-edge border, accent-deep text, and a 1px lift shadow.

### Style panel & popovers (cards, done right)
- **Corners:** `12px` (`{rounded.xl}`). **Background:** floating white. **Shadow:** Card. **Border:** 1px hairline. **Padding:** `12px`. Sections stack with a hairline divider + `12px` top padding between them. Draggable by its header (grab cursor). These are the *only* card-like surfaces — there are no content card grids anywhere.

### Inputs / Fields
- **Style:** app-surface (`#fafaf9`) or white fill, `border-soft` 1px stroke, `7px` radius, 30px height.
- **Focus:** border shifts to Drafting Blue Edge + a 2px Drafting Blue Wash ring (`box-shadow: 0 0 0 2px var(--ep-accent-bg)`). No glow, no scale.

### Swatches
- 18×18, `5px` radius, faint inset border. Selected = a 1.5px surface gap then a 3px Drafting Blue ring (double box-shadow). Transparent fill is drawn as an 8px checkerboard so "see-through" reads literally.

### Navigation / Chrome bars
- **Header** (44px) and **footer** (28px): white, 1px bottom/top hairline, no shadow. Footer is mono, muted, with hairline `·` separators; errors switch to Error Red with an inline icon.
- **Editor tab bar** (36px): on the dark slab; tabs carry a 1.5px blue top-rule to mark the active file, mono labels, hover-revealed actions.

### Keycaps
- Inline `kbd`: white surface, 1px hairline, `4px` radius, mono 10.5px, `1px 6px` padding. Used in hints and menus to show shortcuts — reinforcing the keyboard-first posture.

## 6. Do's and Don'ts

### Do:
- **Do** keep the blue accent rare — active and focused states only (The One Blue Rule). Emphasis elsewhere comes from weight, the stone ramp, or a hairline.
- **Do** set every coordinate, percentage, keycap, file name, and code value in JetBrains Mono (The Mono-for-Mechanism Rule).
- **Do** separate surfaces with the tonal ramp (`#ecebe7` → `#fafaf9` → `#ffffff`) and 1px hairlines; add a Card shadow *only* when the element floats over the canvas.
- **Do** keep the diagram's ten saturated hues for diagram content only; keep chrome in stone + one blue (The Two-Worlds Rule).
- **Do** hold targets exact and compact — 32px tool cells, 28/38px dock controls, 10–13px type — and verify body text clears 4.5:1 (placeholder text included).
- **Do** give every interactive element a visible focus state and a `prefers-reduced-motion` fallback; transitions are short and ease-out, never bouncy.

### Don't:
- **Don't** ship generic AI-SaaS surfaces — no gradient hero, no glassmorphism, no decorative blur, no big-number metric template, no identical card grids. The only card-like surfaces are the style panel and popovers.
- **Don't** drift into playful/hand-sketched (Excalidraw) styling for the chrome, or into heavy enterprise CAD chrome (stacked toolbars, ribbons, modal soup). Stay light and exact.
- **Don't** use the blue accent as a fill for emphasis, a gradient, or decoration. It marks state, nothing else.
- **Don't** paint UI chrome with a diagram hue, or paint a node/edge with `--ep-accent`. The two palettes never swap roles.
- **Don't** add `border-left`/`border-right` colored stripes on panels, list items, or alerts; use full hairlines, tonal fills, or an icon instead.
- **Don't** put a shadow on docked chrome (header, footer, tab bar) — a hairline does that job (The Float-Earns-Shadow Rule).
