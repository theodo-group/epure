import { describe, expect, it } from 'vitest'

// Prove the browser embed writes chunks the server reader accepts — the two
// live in different files (browser Uint8Array vs. Node Buffer) but must be
// byte-compatible so a UI-exported PNG round-trips through `epure source`.
import { readPngText, PNG_SOURCE_KEYS } from '../../server/render/pngText'
import { embedPngText, epureMetaEntries } from './pngText'

// A minimal valid PNG (1×1) to splice into: signature + IHDR + IDAT + IEND.
const tinyPng = (): Uint8Array => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const chunk = (type: string, data: number[]): number[] => {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(data)
    const len = data.length
    // CRC over type+data (matches the writer's polynomial).
    let crc = 0xffffffff
    for (const b of body) {
      crc ^= b
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
    return [...be(len), ...body, ...be(crc)]
  }
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
  const idat = chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])
  const iend = chunk('IEND', [])
  return Uint8Array.from([...sig, ...ihdr, ...idat, ...iend])
}

describe('browser PNG source embedding', () => {
  it('embeds Épure source that the server reader round-trips', () => {
    const d2 = 'user: Utilisateur { shape: person }\nuser -> api: héllo ☕\n'
    const layout = '{ "gridSize": 40 }'
    const out = embedPngText(tinyPng(), epureMetaEntries(d2, layout))
    // Buffer.from(view) so the Node-side reader sees the same bytes.
    const meta = readPngText(Buffer.from(out))
    expect(meta[PNG_SOURCE_KEYS.d2]).toBe(d2)
    expect(meta[PNG_SOURCE_KEYS.layout]).toBe(layout)
    expect(meta.Software).toContain('Épure')
    expect(meta.Description).toContain('epure source')
  })

  it('leaves a non-PNG input untouched', () => {
    const notPng = Uint8Array.from([1, 2, 3])
    expect(embedPngText(notPng, epureMetaEntries('x', null))).toBe(notPng)
  })
})
