// Drift guard: the epure-diagram SKILL teaches the layout schema to Claude
// Code, so it MUST stay in sync with the real validator. This asserts every
// enum value the validator accepts is documented in the SKILL, the canonical
// example it cites is schema-valid, and the old (stale) pixel/array schema is
// gone for good.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  END_CAPS,
  FILL_COLORS,
  ICON_POSITIONS,
  LINE_STYLES,
  PALETTE_COLORS,
  SHAPES,
  SIDES,
  SIZES,
  validateLayoutJson,
} from '@/file/layoutSchema'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const SKILL = read('skills/epure-diagram/SKILL.md')

describe('epure-diagram SKILL stays in sync with the validator', () => {
  it('documents every accepted enum value', () => {
    const allValues = new Set<string>([
      ...PALETTE_COLORS,
      ...FILL_COLORS,
      ...SIZES,
      ...LINE_STYLES,
      ...END_CAPS,
      ...ICON_POSITIONS,
      ...SIDES,
      ...SHAPES,
    ] as string[])
    const missing = [...allValues].filter((v) => !SKILL.includes(v))
    expect(missing).toEqual([])
  })

  it('names the required node geometry fields in grid units, not pixels', () => {
    for (const field of ['cx', 'cy', 'gridSize']) {
      expect(SKILL).toContain(field)
    }
    // The stale schema used pixel x/y on nodes and an array of areas with
    // members/x/y. Make sure neither sneaks back into the teaching material.
    expect(SKILL).not.toMatch(/"x":\s*\d/)
    expect(SKILL).not.toMatch(/"members"\s*:/)
  })

  it('cites a canonical example that actually passes the validator', () => {
    expect(SKILL).toContain('fixtures/system.epr')
    const fixture = read('fixtures/system.epr.layout.json')
    expect(validateLayoutJson(fixture).value).not.toBeNull()
  })

  it('teaches the edge key format and the parallel-edge caveat', () => {
    expect(SKILL).toContain('src->tgt')
    expect(SKILL.toLowerCase()).toContain('parallel')
  })
})
