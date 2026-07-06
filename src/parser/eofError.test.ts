// Chevrotain's EOF token carries NaN for every position field. An error anchored
// there once produced a NaN range that crashed the editor's `doc.line(NaN)` on
// the next render. Every parse error must expose a finite, editor-safe range.
import { describe, it, expect } from 'vitest'
import { parse } from '@/parser'

// Incomplete states a user types THROUGH (id + colon, dangling edge, open brace,
// unterminated string) — each errors on EOF.
const INCOMPLETE = ['jean_claude:', 'jean_claude: ', 'a -> ', 'a ->', 'a: "', 'a: b {', 'a: label {\n', 'x: {']

describe('parse errors never carry a NaN range', () => {
  for (const src of INCOMPLETE) {
    it(`finite range for ${JSON.stringify(src)}`, () => {
      const r = parse(src)
      expect(r.ok).toBe(false)
      if (r.ok) return
      for (const e of r.errors) {
        for (const p of [e.range.start, e.range.end]) {
          expect(Number.isInteger(p.line)).toBe(true)
          expect(p.line).toBeGreaterThanOrEqual(1)
          expect(Number.isFinite(p.column)).toBe(true)
          expect(Number.isFinite(p.offset)).toBe(true)
        }
      }
    })
  }

  it('anchors an EOF error at the end of input', () => {
    const src = 'a\njean_claude:'
    const r = parse(src)
    expect(r.ok).toBe(false)
    if (r.ok) return
    // Last line of a 2-line doc.
    expect(r.errors.some((e) => e.range.start.line === 2)).toBe(true)
  })
})
