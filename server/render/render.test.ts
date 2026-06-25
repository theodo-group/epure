import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildRenderModel } from './model'
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
    const model = await buildRenderModel(D2, LAYOUT)
    if ('error' in model) throw new Error(model.error)
    expect(model.routed.nodes.map((n) => n.id)).toContain('api')
    expect(model.routed.edges.length).toBeGreaterThan(0)
    expect(model.routed.areas.map((a) => a.id)).toContain('Services')
    expect(model.nodes.user).toMatchObject({ shape: 'person' })
  })

  it('renders an SVG fit to content (no fixed canvas size)', async () => {
    const model = await buildRenderModel(D2, LAYOUT)
    if ('error' in model) throw new Error(model.error)
    const svg = renderSvgString(model, { padding: 24 })
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
    const model = await buildRenderModel(D2, LAYOUT)
    if ('error' in model) throw new Error(model.error)
    const svg = inlineIcons(renderSvgString(model), ICONS)
    expect(svg).not.toMatch(/href="\/icons\//) // all rewritten
    expect(svg).toContain('data:image/png;base64,')
  })

  it('rasterizes to a real PNG', async () => {
    const model = await buildRenderModel(D2, LAYOUT)
    if ('error' in model) throw new Error(model.error)
    const png = svgToPng(inlineIcons(renderSvgString(model), ICONS), { scale: 1 })
    expect(Buffer.isBuffer(png)).toBe(true)
    // PNG magic number.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.length).toBeGreaterThan(1000)
  })

  it('reports an error for an unparseable diagram instead of throwing', async () => {
    const model = await buildRenderModel('a -> ', null)
    expect('error' in model).toBe(true)
  })

  it('renders a .d2-only diagram (auto-placed, no layout file)', async () => {
    const model = await buildRenderModel('a\nb\na -> b\n', null)
    if ('error' in model) throw new Error(model.error)
    const png = svgToPng(renderSvgString(model), { scale: 1 })
    expect(png.length).toBeGreaterThan(500)
  })
})
