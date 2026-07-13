// Embed (and read back) UTF-8 text metadata in a PNG via `iTXt` chunks — this
// is how the exported/rendered image carries the diagram's own source, so a
// `.png` is a self-contained, round-trippable record of the pair (the way
// draw.io embeds its `mxfile` source). resvg emits no metadata, so we splice the
// chunks in ourselves.
//
// PNG layout: 8-byte signature, then a sequence of chunks, each
//   length(4, BE) | type(4) | data(length) | crc(4, BE over type+data).
// The first chunk is always IHDR; text chunks may appear anywhere after it and
// before IEND, so we insert right after IHDR. Unknown-to-viewers text chunks are
// ignored by every renderer, so this never affects how the image displays.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// CRC-32/ISO-HDLC (the PNG/zlib variant). Small enough to inline; avoids
// depending on `zlib.crc32`, which isn't in every supported Node 20.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!)! & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A single `iTXt` chunk (keyword + UTF-8 text, uncompressed, no language tag). */
const iTXtChunk = (keyword: string, text: string): Buffer => {
  const body = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0x00]), // keyword null-terminator
    Buffer.from([0x00, 0x00]), // compression flag (0 = none) + method
    Buffer.from([0x00]), // empty language tag + null
    Buffer.from([0x00]), // empty translated keyword + null
    Buffer.from(text, 'utf8'),
  ])
  const type = Buffer.from('iTXt', 'latin1')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, body])), 0)
  return Buffer.concat([len, type, body, crc])
}

const isPng = (png: Buffer): boolean =>
  png.length >= 33 && png.subarray(0, 8).equals(PNG_SIGNATURE) && png.subarray(12, 16).toString('latin1') === 'IHDR'

/**
 * Return `png` with an `iTXt` chunk per entry spliced in after IHDR. A
 * non-PNG (or empty-entries) input is returned untouched — embedding metadata
 * must never be able to corrupt the image.
 */
export const embedPngText = (
  png: Buffer,
  entries: { keyword: string; text: string }[],
): Buffer => {
  if (entries.length === 0 || !isPng(png)) return png
  const ihdrLen = png.readUInt32BE(8)
  const insertAt = 8 + 4 + 4 + ihdrLen + 4 // signature + (len + type + data + crc)
  const chunks = entries.map((e) => iTXtChunk(e.keyword, e.text))
  return Buffer.concat([png.subarray(0, insertAt), ...chunks, png.subarray(insertAt)])
}

/** Read every `iTXt`/`tEXt` chunk back into a keyword→text map. Inverse of
 *  `embedPngText`; used by tests today, and the basis for "recover source from
 *  an image" later. */
export const readPngText = (png: Buffer): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!isPng(png)) return out
  let off = 8
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off)
    const type = png.subarray(off + 4, off + 8).toString('latin1')
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === 'tEXt') {
      const sep = data.indexOf(0x00)
      if (sep >= 0) out[data.subarray(0, sep).toString('latin1')] = data.subarray(sep + 1).toString('latin1')
    } else if (type === 'iTXt') {
      const kwEnd = data.indexOf(0x00)
      if (kwEnd >= 0) {
        const keyword = data.subarray(0, kwEnd).toString('latin1')
        // after keyword\0: compFlag(1) compMethod(1) lang\0 transKeyword\0 text
        const langStart = kwEnd + 3
        const langEnd = data.indexOf(0x00, langStart)
        const transEnd = data.indexOf(0x00, langEnd + 1)
        out[keyword] = data.subarray(transEnd + 1).toString('utf8')
      }
    }
    if (type === 'IEND') break
    off += 8 + len + 4 // len + type + data + crc
  }
  return out
}

/** Keywords under which the diagram source is stored in rendered PNGs. */
export const PNG_SOURCE_KEYS = {
  d2: 'epure.d2',
  layout: 'epure.layout.json',
} as const
