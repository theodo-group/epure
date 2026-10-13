import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readPngText as readPngTextServer } from '../../server/render/pngText'
import { embedPngText, epureMetaEntries, readPngText } from '@/export/pngText'
import { validateLayoutJson } from '@/file/layoutSchema'
import { OpenError, openFiles } from './open'

const fixture = (name: string): Buffer => readFileSync(resolve(__dirname, '../../fixtures', name))
const file = (bytes: string | Uint8Array, name: string, type = ''): File =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type })

const SYSTEM_D2 = fixture('system.epr.d2').toString('utf8')
const SYSTEM_LAYOUT = fixture('system.epr.layout.json').toString('utf8')

// Smallest PNG `embedPngText` accepts: signature + a 1×1 IHDR + IEND.
const tinyPng = (): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // signature
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1,
    8,
    6,
    0,
    0,
    0,
    0x1f,
    0x15,
    0xc4,
    0x89,
    0,
    0,
    0,
    0,
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82, // IEND
  ])

describe('readPngText (browser)', () => {
  it('reads the same chunks as the server reader', () => {
    const png = fixture('renault-gcp.png')
    expect(readPngText(new Uint8Array(png))).toEqual(readPngTextServer(png))
  })

  it('round-trips what embedPngText writes, including non-ASCII text', () => {
    const png = embedPngText(tinyPng(), epureMetaEntries('a: Équipe → b', '{"x":1}'))
    expect(readPngText(png)).toMatchObject({
      'epure.d2': 'a: Équipe → b',
      'epure.layout.json': '{"x":1}',
    })
  })

  it('returns nothing for bytes that are not a PNG', () => {
    expect(readPngText(new TextEncoder().encode('not a png'))).toEqual({})
  })
})

describe('openFiles', () => {
  it('recovers the editable pair from a PNG exported by Épure', async () => {
    const doc = await openFiles([file(fixture('renault-gcp.png'), 'renault-gcp.png', 'image/png')])
    expect(doc.source).toBe(fixture('renault-gcp.epr.d2').toString('utf8'))
    expect(doc.layout).toEqual(
      validateLayoutJson(fixture('renault-gcp.epr.layout.json').toString('utf8')).value,
    )
    expect(doc.filename).toBe('renault-gcp')
  })

  it('opens a PNG that carries only the d2 with auto-placement', async () => {
    const png = embedPngText(tinyPng(), epureMetaEntries('a -> b', null))
    const doc = await openFiles([file(png, 'flow.png')])
    expect(doc.source).toBe('a -> b')
    expect(doc.layout.nodes).toEqual({})
  })

  it('explains when a PNG has no Épure source (re-compressed)', async () => {
    const stripped = file(fixture('conversation-architecture.png'), 'pasted.png', 'image/png')
    await expect(openFiles([stripped])).rejects.toThrow(OpenError)
    await expect(openFiles([stripped])).rejects.toThrow(/pasted\.png has no Épure source/)
  })

  it('opens the .epr.d2 + .epr.layout.json pair, whatever the selection order', async () => {
    const doc = await openFiles([
      file(SYSTEM_LAYOUT, 'system.epr.layout.json'),
      file(SYSTEM_D2, 'system.epr.d2'),
    ])
    expect(doc.source).toBe(SYSTEM_D2)
    expect(doc.layout).toEqual(validateLayoutJson(SYSTEM_LAYOUT).value)
    expect(doc.filename).toBe('system')
  })

  it('opens a .d2 alone with an empty layout (nodes are auto-placed)', async () => {
    const doc = await openFiles([file('a -> b', 'sketch.d2')])
    expect(doc).toEqual({
      source: 'a -> b',
      layout: { gridSize: 40, nodes: {}, edges: {} },
      filename: 'sketch',
    })
  })

  it('asks for the .epr.d2 when only a layout is picked', async () => {
    await expect(openFiles([file(SYSTEM_LAYOUT, 'system.epr.layout.json')])).rejects.toThrow(
      /Pick the \.epr\.d2 file too/,
    )
  })

  it('names what Épure opens when the files are something else', async () => {
    await expect(openFiles([file('hello', 'notes.txt')])).rejects.toThrow(
      /Épure opens \.epr\.d2 files/,
    )
  })

  it('reports an invalid layout with its line instead of opening a broken document', async () => {
    await expect(
      openFiles([file('a', 'x.epr.d2'), file('{\n  "gridSize": ', 'x.epr.layout.json')]),
    ).rejects.toThrow(/x\.epr\.layout\.json isn't a valid Épure layout \(line \d+\)/)
  })
})
