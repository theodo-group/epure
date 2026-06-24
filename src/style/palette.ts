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
  black: { solid: '#1c1917', fill: '#fafaf9' },
  gray: { solid: '#78716c', fill: '#f5f5f4' },
  red: { solid: '#dc2626', fill: '#fef2f2' },
  orange: { solid: '#ea580c', fill: '#fff7ed' },
  yellow: { solid: '#ca8a04', fill: '#fefce8' },
  green: { solid: '#16a34a', fill: '#f0fdf4' },
  teal: { solid: '#0d9488', fill: '#f0fdfa' },
  blue: { solid: '#2563eb', fill: '#eff6ff' },
  purple: { solid: '#9333ea', fill: '#faf5ff' },
  pink: { solid: '#db2777', fill: '#fdf2f8' },
}

// Fills additionally allow an explicit transparent (no-fill) choice, distinct
// from leaving the colour unset (which falls back to the theme default fill).
export type FillColor = PaletteColor | 'transparent'

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
