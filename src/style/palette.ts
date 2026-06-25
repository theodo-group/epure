// Shared style palette and size scales for nodes, edges, and areas.
// Excalidraw-inspired colour names — saved in the JSON layout file as
// short string tokens so the file stays human-readable.

export type PaletteColor =
  | 'black'
  | 'gray'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'

interface PaletteEntry {
  solid: string
  fill: string
}

export const PALETTE: Record<PaletteColor, PaletteEntry> = {
  // Black/gray stay neutral. Chromatic hues use Tailwind 500 — the most
  // saturated step before colors start losing chroma to darken — for punchy
  // strokes, paired with pale 50 fills so colored bodies remain readable.
  black: { solid: '#0c0a09', fill: '#fafaf9' },
  gray: { solid: '#78716c', fill: '#e7e5e4' },
  red: { solid: '#ef4444', fill: '#fef2f2' },
  orange: { solid: '#f97316', fill: '#fff7ed' },
  yellow: { solid: '#eab308', fill: '#fefce8' },
  green: { solid: '#22c55e', fill: '#f0fdf4' },
  teal: { solid: '#14b8a6', fill: '#f0fdfa' },
  blue: { solid: '#3b82f6', fill: '#eff6ff' },
  purple: { solid: '#a855f7', fill: '#faf5ff' },
  pink: { solid: '#ec4899', fill: '#fdf2f8' },
}

// Fills additionally allow two non-palette choices: `transparent` (see-through,
// still hit-testable) and `white` (explicit #ffffff — distinct from leaving
// the colour unset, which falls back to the theme default).
export type FillColor = PaletteColor | 'transparent' | 'white'

// Resolve a FillColor to a concrete SVG fill string. Returns null when the
// colour is unset, so callers can apply their own per-context default.
export const resolveFill = (fc: FillColor | undefined): string | null => {
  if (fc === undefined) return null
  if (fc === 'transparent') return 'transparent'
  if (fc === 'white') return '#ffffff'
  return fillOf(fc)
}

export type Size = 'S' | 'M' | 'L' | 'XL'

export const TEXT_SIZE: Record<Size, number> = {
  S: 10,
  M: 12,
  L: 14,
  XL: 18,
}

export const STROKE_WIDTH: Record<Size, number> = {
  S: 1,
  M: 1.5,
  L: 2.5,
  XL: 4,
}

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export const dashArrayFor = (style: LineStyle, width = 1.5): string | undefined => {
  if (style === 'solid') return undefined
  if (style === 'dashed') return `${width * 4} ${width * 3}`
  return `${width} ${width * 2}` // dotted
}

export type EndCap = 'none' | 'arrow' | 'dot' | 'diamond'

export const solidOf = (color?: PaletteColor): string =>
  PALETTE[color ?? 'black'].solid

export const fillOf = (color?: PaletteColor): string =>
  PALETTE[color ?? 'gray'].fill
