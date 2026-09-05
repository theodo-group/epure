import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { model } from './model'
import { png, source, svg } from './index'
import {
  embedPngText,
  readPngText,
  epureMetaEntries,
  PNG_SOURCE_KEYS,
  PNG_MARKER_KEYS,
} from './pngText'
import { inlineIcons, renderSvgString } from './svg'
import { svgToPng } from './png'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const D2 = read('fixtures/system.epr.d2')
const LAYOUT = read('fixtures/system.epr.layout.json')
const ICONS = resolve(process.cwd(), 'public/icons')

const viewBoxOf = (svg: string) => {
  const m = svg.match(/viewBox="([^"]+)"/)
  if (!m) throw new Error('no viewBox')
  const [x, y, w, h] = m[1]!.split(' ').map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}

describe('headless diagram render', () => {
  it('builds a routed model with the fixture topology', async () => {
    const m = await model(D2, LAYOUT)
    if ('error' in m) throw new Error(m.error)
    expect(m.routed.nodes.map((n) => n.id)).toContain('api')
    expect(m.routed.edges.length).toBeGreaterThan(0)
    expect(m.routed.areas.map((a) => a.id)).toContain('Services')
    expect(m.nodes.user).toMatchObject({ shape: 'person' })
  })

  it('renders an SVG fit to content (no fixed canvas size)', async () => {
    const m = await model(D2, LAYOUT)
    if ('error' in m) throw new Error(m.error)
    const svg = renderSvgString(m, { padding: 24 })
    expect(svg.startsWith('<svg')).toBe(true)
    // width/height equal the viewBox extent → proportions preserved, fitted.
    const vb = viewBoxOf(svg)
    expect(svg).toContain(`width="${vb.w}"`)
    expect(svg).toContain(`height="${vb.h}"`)
    // Tight-ish: the fixture is wider than tall, never the 800×600 fallback.
    expect(vb.w).not.toBe(800)
    expect(vb.w).toBeGreaterThan(vb.h)
    // Reuses the real renderer: node + area labels are present (single-word
    // labels aren't split across wrap tspans).
    expect(svg).toContain('Postgres')
    expect(svg).toContain('Services')
  })

  it('inlines icon files as data URIs', async () => {
    const m = await model(D2, LAYOUT)
    if ('error' in m) throw new Error(m.error)
    const svg = inlineIcons(renderSvgString(m), ICONS)
    expect(svg).not.toMatch(/href="\/icons\//) // all rewritten
    expect(svg).toContain('data:image/png;base64,')
  })

  it('rasterizes to a real PNG', async () => {
    const m = await model(D2, LAYOUT)
    if ('error' in m) throw new Error(m.error)
    const png = svgToPng(inlineIcons(renderSvgString(m), ICONS), { scale: 1 })
    expect(Buffer.isBuffer(png)).toBe(true)
    // PNG magic number.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.length).toBeGreaterThan(1000)
  })

  it('reports an error for an unparseable diagram instead of throwing', async () => {
    const m = await model('a -> ', null)
    expect('error' in m).toBe(true)
  })

  it('renders a .d2-only diagram (auto-placed, no layout file)', async () => {
    const m = await model('a\nb\na -> b\n', null)
    if ('error' in m) throw new Error(m.error)
    const png = svgToPng(renderSvgString(m), { scale: 1 })
    expect(png.length).toBeGreaterThan(500)
  })

  it('embeds the diagram source in the rendered PNG (round-trips, incl. layout)', async () => {
    const bytes = await png(D2, LAYOUT, { icons: ICONS, scale: 1 })
    if (!Buffer.isBuffer(bytes)) throw new Error(bytes.error)
    // Still a valid PNG after splicing metadata chunks.
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const meta = readPngText(bytes)
    expect(meta[PNG_SOURCE_KEYS.d2]).toBe(D2)
    expect(meta[PNG_SOURCE_KEYS.layout]).toBe(LAYOUT)
    // Self-describing marker: a reader handed only the image can tell it's an
    // Épure diagram and learn that its source is embedded + how to recover it.
    expect(meta[PNG_MARKER_KEYS.software]).toContain('Épure')
    expect(meta[PNG_MARKER_KEYS.description]).toContain('epure source')
    expect(meta[PNG_MARKER_KEYS.description]).toContain(PNG_SOURCE_KEYS.d2)
  })

  it('omits the layout key when a diagram has no layout file', async () => {
    const bytes = await png('a\nb\na -> b\n', null, { scale: 1, icons: false })
    if (!Buffer.isBuffer(bytes)) throw new Error(bytes.error)
    const meta = readPngText(bytes)
    expect(meta[PNG_SOURCE_KEYS.d2]).toBe('a\nb\na -> b\n')
    expect(meta[PNG_SOURCE_KEYS.layout]).toBeUndefined()
  })
})

describe('the library surface', () => {
  it('svg() inlines the packaged icons by default', async () => {
    const out = await svg(D2, LAYOUT)
    if (typeof out !== 'string') throw new Error(out.error)
    expect(out).not.toMatch(/href="\/icons\//)
    expect(out).toContain('data:image/png;base64,')
  })

  it('source() recovers the pair from a rendered PNG, null otherwise', async () => {
    const bytes = await png(D2, LAYOUT, { scale: 1, icons: false })
    if (!Buffer.isBuffer(bytes)) throw new Error(bytes.error)
    expect(source(bytes)).toEqual({ d2: D2, layout: LAYOUT })
    expect(source(Buffer.from('not a png'))).toBeNull()
  })
})

describe('PNG text metadata', () => {
  it('round-trips UTF-8 keywords and text through iTXt chunks', () => {
    // A minimal but valid PNG to splice into (1×1 via a tiny render).
    const base = svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>', { scale: 1 })
    const text = 'user: Utilisateur { shape: person }\napi: "Café ☕ API"\nuser -> api: héllo\n'
    const out = embedPngText(base, [{ keyword: 'epure.d2', text }])
    expect(out.subarray(0, 8)).toEqual(base.subarray(0, 8)) // signature intact
    expect(out.length).toBeGreaterThan(base.length)
    expect(readPngText(out)['epure.d2']).toBe(text)
  })

  it('returns a non-PNG buffer untouched (never corrupts input)', () => {
    const notPng = Buffer.from('not a png at all')
    expect(embedPngText(notPng, [{ keyword: 'k', text: 'v' }])).toBe(notPng)
    expect(readPngText(notPng)).toEqual({})
  })

  it('epureMetaEntries carries the marker + source, and omits layout when absent', () => {
    const withLayout = epureMetaEntries('a -> b', '{}')
    const keys = withLayout.map((e) => e.keyword)
    expect(keys).toEqual(['Software', 'Description', 'epure.d2', 'epure.layout.json'])
    expect(withLayout.find((e) => e.keyword === 'epure.d2')?.text).toBe('a -> b')

    const noLayout = epureMetaEntries('a -> b', null)
    expect(noLayout.map((e) => e.keyword)).not.toContain('epure.layout.json')
    // The layout *chunk* isn't described when there's no layout (the recovery
    // command still names the `.epr.layout.json` file, so key on the chunk id).
    expect(noLayout.find((e) => e.keyword === 'Description')?.text).not.toContain(
      PNG_SOURCE_KEYS.layout,
    )
    expect(withLayout.find((e) => e.keyword === 'Description')?.text).toContain(
      PNG_SOURCE_KEYS.layout,
    )
  })
})
