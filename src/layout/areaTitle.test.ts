import { describe, expect, it } from 'vitest'

import { areaMinWidth, areaTitleRect } from './areaTitle'

describe('areaTitleRect under text zoom', () => {
  const label = 'A Very Long Overhanging Group Title Here'
  // An area the router widened to exactly fit the title at scale 1.
  const area = { x: 100, y: 100, w: areaMinWidth(label), h: 200 }
  const inside = (r: { x: number; w: number }) => r.x >= area.x && r.x + r.w <= area.x + area.w

  it('never draws the chip past the frame, whatever the alignment', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      expect(inside(areaTitleRect(area, label, align, 1.5))).toBe(true)
    }
  })

  it('still zooms a short title that has room', () => {
    expect(areaTitleRect(area, 'Short', 'left', 1.5).h).toBe(33)
  })

  it('centers a chip wider than its frame', () => {
    const narrow = { ...area, w: 200 }
    const chip = areaTitleRect(narrow, label, 'right')
    expect(chip.x + chip.w / 2).toBe(narrow.x + narrow.w / 2)
  })
})
