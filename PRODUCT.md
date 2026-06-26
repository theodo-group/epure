# Product

## Register

product

## Users

Developers and software architects who drive Épure through Claude Code from
inside their own repository. They live in a terminal and an editor; the diagram
is one artifact among many in a working session, not a destination they visit.
Their context is an active engineering task — documenting or reviewing a
system's architecture — where the diagram must stay in sync with the code and
diff cleanly in a pull request. They also tweak diagrams by hand (drag a node,
restyle, drop a comment) and expect those edits to round-trip back to the file
pair. They are power users: keyboard-first, fast, low tolerance for chrome or
ceremony.

## Product Purpose

Épure turns architecture diagrams into a reviewable file pair (`<name>.epr.d2` +
`<name>.epr.layout.json`) that lives in the repo and renders live in a
grid-snapped, orthogonal-routed editor. It exists so that diagrams stop drifting
from reality: Claude Code writes the files, the human watches them render
instantly, comments on the canvas, and the loop closes. No SaaS, no account,
nothing leaves the machine. Success is the editor disappearing — the user thinks
about the system being diagrammed, never about the tool. Fast feedback, clean
diffs, and edits that always round-trip are the measure.

## Brand Personality

Precise, quiet, technical. The voice is a sharp engineering instrument, not a
consumer app: confident through restraint, never loud. It speaks in exact terms,
shows rather than decorates, and trusts the user's expertise. Calm under a dense
workload — a tool that respects focus.

## Anti-references

- **Generic AI-SaaS.** No gradient hero, no glassmorphism, no decorative blur, no
  endless identical card grids, no big-number metric templates. If it looks like
  a Series-A landing page, it is wrong.
- Playful / hand-sketched aesthetics (Excalidraw-style): Épure is exact, not loose.
- Heavy enterprise CAD chrome (Lucidchart / Visio): toolbars stacked on toolbars,
  ribbon density, modal-heavy flows. Épure stays light.

## Design Principles

- **Invisible by default.** The interface earns attention only when the user needs
  it; the canvas and the diagram are the subject. Chrome recedes.
- **Precision is the aesthetic.** Grid snapping, orthogonal routes, exact spacing
  and alignment ARE the brand. Sloppiness reads as a bug.
- **Keyboard-first, hand-second.** Every common action has a shortcut; pointer
  interaction is a complement, never the only path.
- **Round-trips or it didn't happen.** Any visual edit must write back to the file
  pair faithfully; the diagram on screen and the diff in the PR are the same truth.
- **Earn every pixel of UI.** A control appears only when it pays for the space it
  takes. Density over decoration.

## Accessibility & Inclusion

Target WCAG 2.1 AA: body text ≥4.5:1 and large/UI text ≥3:1 against its
background, visible focus states on every interactive element, and a
`prefers-reduced-motion` alternative for all motion. Beyond AA, hold a high bar
for **keyboard-first** operation — full keyboard reachability and discoverable
shortcuts, since the primary users are power users. Honor reduced-motion on the
live-render and canvas interactions especially.
