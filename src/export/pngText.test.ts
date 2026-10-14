import { describe, expect, it } from 'vitest'

// Prove the browser embed writes chunks the server reader accepts — the two
// live in different files (browser Uint8Array vs. Node Buffer) but must be
// byte-compatible so a UI-exported PNG round-trips through `epure source`.
import { readPngText, PNG_SOURCE_KEYS } from '../../server/render/pngText'
import { embedPngText, epureMetaEntries } from './pngText'

// CRC-32 as the PNG spec defines it (bitwise, independent of the writer's table).
const crc32 = (bytes: ArrayLike<number>): number => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

// A minimal valid PNG (1×1) to splice into: signature + IHDR + IDAT + IEND.
const tinyPng = (): Uint8Array => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const chunk = (type: string, data: number[]): number[] => {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(data)
    const len = data.length
    const crc = crc32(body)
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

  it('writes spec-conformant iTXt chunks a strict decoder accepts', () => {
    // A strict reader, per the PNG spec: every chunk's CRC must check, and an
    // iTXt is keyword\0, compression flag, method, language\0, translated
    // keyword\0, then text — UTF-8, and only inflated when the flag says 1.
    const png = embedPngText(tinyPng(), epureMetaEntries('a: Équipe → b', '{"x":1}'))
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const latin1 = new TextDecoder('latin1')
    const types: string[] = []
    const texts: Record<string, string> = {}
    for (let off = 8; off < png.length; ) {
      const len = view.getUint32(off)
      const typeAndData = png.subarray(off + 4, off + 8 + len)
      const type = latin1.decode(typeAndData.subarray(0, 4))
      expect(view.getUint32(off + 8 + len), `${type} CRC`).toBe(crc32(typeAndData))
      types.push(type)
      if (type === 'iTXt') {
        const data = typeAndData.subarray(4)
        const kwEnd = data.indexOf(0)
        const keyword = latin1.decode(data.subarray(0, kwEnd))
        expect(keyword.length).toBeGreaterThan(0)
        expect(keyword.length).toBeLessThan(80)
        expect([data[kwEnd + 1], data[kwEnd + 2]], `${keyword} compression`).toEqual([0, 0])
        const langEnd = data.indexOf(0, kwEnd + 3)
        const transEnd = data.indexOf(0, langEnd + 1)
        expect([langEnd, transEnd]).toEqual([kwEnd + 3, kwEnd + 4]) // both empty
        texts[keyword] = new TextDecoder('utf-8', { fatal: true }).decode(
          data.subarray(transEnd + 1),
        )
      }
      off += 12 + len
    }
    // Text chunks sit between IHDR and the image data; IEND stays last.
    expect(types).toEqual(['IHDR', 'iTXt', 'iTXt', 'iTXt', 'iTXt', 'IDAT', 'IEND'])
    expect(texts[PNG_SOURCE_KEYS.d2]).toBe('a: Équipe → b')
    expect(texts[PNG_SOURCE_KEYS.layout]).toBe('{"x":1}')
  })

  it('leaves a non-PNG input untouched', () => {
    const notPng = Uint8Array.from([1, 2, 3])
    expect(embedPngText(notPng, epureMetaEntries('x', null))).toBe(notPng)
  })
})
