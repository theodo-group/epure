// Geometry of an area's title "chip" — the rounded tab straddling the area's top
// border. Shared by the renderer (AreaLabel) and routing (elk.ts, where the chip
// is an obstacle) so the two can never drift. Kept free of the libavoid import
// so the renderer can use it without pulling the router in.

import type { AreaLabelAlign } from './types'

type Rect = { x: number; y: number; w: number; h: number }

export const TITLE_INSET_X = 14 // chip inset from the area's left/right edge
const TITLE_HEIGHT = 22
// Approximate glyph advance at the label's font size; keeps the chip wide enough
// for the rendered text without measuring the DOM (the headless export has none).
const TITLE_CHAR_PX = 7
const TITLE_PAD_X = 10
const TITLE_MIN_W = 40

export const areaTitleWidth = (label: string, scale = 1): number =>
  Math.max(TITLE_MIN_W, label.length * TITLE_CHAR_PX + TITLE_PAD_X * 2) * scale

// Narrowest area that still holds its title chip with an inset on both sides.
export const areaMinWidth = (label: string): number => areaTitleWidth(label) + TITLE_INSET_X * 2

// Scale the chip is drawn at under a live text zoom. The router widens areas at
// scale 1 only, so a zoomed chip grows only while it still fits inside the
// frame; it never shrinks below scale 1 for that (the export geometry).
export const areaTitleScale = (areaW: number, label: string, textScale = 1): number =>
  Math.min(textScale, Math.max(1, (areaW - TITLE_INSET_X * 2) / areaTitleWidth(label)))

export const areaTitleRect = (
  areaRect: Rect,
  label: string,
  align: AreaLabelAlign = 'center',
  textScale = 1,
): Rect => {
  const scale = areaTitleScale(areaRect.w, label, textScale)
  const w = areaTitleWidth(label, scale)
  const h = TITLE_HEIGHT * scale
  // A chip wider than the frame (the router could not widen it past a
  // neighbour) is centered so it overhangs both sides evenly.
  const fits = w <= areaRect.w - TITLE_INSET_X * 2 + 1e-6
  const x =
    fits && align === 'left'
      ? areaRect.x + TITLE_INSET_X
      : fits && align === 'right'
        ? areaRect.x + areaRect.w - TITLE_INSET_X - w
        : areaRect.x + (areaRect.w - w) / 2
  return { x, y: areaRect.y - h / 2, w, h }
}
