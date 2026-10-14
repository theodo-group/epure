// Embed (and read back) UTF-8 text metadata in a PNG via `iTXt` chunks — this
// is how an exported/rendered image carries the diagram's own source, so a
// `.png` is a self-contained, round-trippable record of the pair (the way
// draw.io embeds its `mxfile` source). Neither the canvas rasterizer (browser
// "Export PNG") nor resvg (`epure export`) emits metadata, so we splice the
// chunks in ourselves, and Open / `epure source` read them back.
//
// PNG layout: 8-byte signature, then a sequence of chunks, each
//   length(4, BE) | type(4) | data(length) | crc(4, BE over type+data).
// The first chunk is always IHDR; text chunks may appear anywhere after it and
// before IEND, so we insert right after IHDR. Unknown-to-viewers text chunks are
// ignored by every renderer, so this never affects how the image displays.
//
// The one implementation for both sides: plain Uint8Array + TextDecoder, so it
// runs in the browser and in Node (server/render/pngText.ts adapts it to Buffer).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// CRC-32/ISO-HDLC (the PNG/zlib variant).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!)! & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)

const u32be = (n: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, false)
  return b
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** A single uncompressed `iTXt` chunk (keyword + UTF-8 text, no language tag). */
const iTXtChunk = (keyword: string, text: string): Uint8Array => {
  const body = concat([
    latin1(keyword),
    Uint8Array.of(0x00), // keyword null-terminator
    Uint8Array.of(0x00, 0x00), // compression flag (0 = none) + method
    Uint8Array.of(0x00), // empty language tag + null
    Uint8Array.of(0x00), // empty translated keyword + null
    utf8(text),
  ])
  const type = latin1('iTXt')
  return concat([u32be(body.length), type, body, u32be(crc32(concat([type, body])))])
}

const readU32be = (buf: Uint8Array, off: number): number =>
  new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0, false)

const isPng = (png: Uint8Array): boolean =>
  png.length >= 33 &&
  PNG_SIGNATURE.every((b, i) => png[i] === b) &&
  latin1('IHDR').every((b, i) => png[12 + i] === b)

/** Return `png` with an `iTXt` chunk per entry spliced in after IHDR. A non-PNG
 *  (or empty-entries) input is returned untouched. */
export const embedPngText = (
  png: Uint8Array,
  entries: { keyword: string; text: string }[],
): Uint8Array => {
  if (entries.length === 0 || !isPng(png)) return png
  const ihdrLen = readU32be(png, 8)
  const insertAt = 8 + 4 + 4 + ihdrLen + 4 // signature + (len + type + data + crc)
  const chunks = entries.map((e) => iTXtChunk(e.keyword, e.text))
  return concat([png.subarray(0, insertAt), ...chunks, png.subarray(insertAt)])
}

/** Read every `iTXt`/`tEXt` chunk back into a keyword→text map. Inverse of
 *  `embedPngText`; Open and `epure source` recover the editable pair with it. */
export const readPngText = (png: Uint8Array): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!isPng(png)) return out
  const decodeLatin1 = new TextDecoder('latin1')
  const decodeUtf8 = new TextDecoder('utf-8')
  let off = 8
  while (off + 8 <= png.length) {
    const len = readU32be(png, off)
    const type = decodeLatin1.decode(png.subarray(off + 4, off + 8))
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === 'tEXt') {
      const sep = data.indexOf(0x00)
      if (sep >= 0)
        out[decodeLatin1.decode(data.subarray(0, sep))] = decodeLatin1.decode(
          data.subarray(sep + 1),
        )
    } else if (type === 'iTXt') {
      const kwEnd = data.indexOf(0x00)
      if (kwEnd >= 0) {
        const keyword = decodeLatin1.decode(data.subarray(0, kwEnd))
        // after keyword\0: compFlag(1) compMethod(1) lang\0 transKeyword\0 text
        const langStart = kwEnd + 3
        const langEnd = data.indexOf(0x00, langStart)
        const transEnd = data.indexOf(0x00, langEnd + 1)
        out[keyword] = decodeUtf8.decode(data.subarray(transEnd + 1))
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

/** Standard PNG text keywords that announce — to any viewer, `exiftool`, or an
 *  agent like Claude Code that reads the image's metadata — that this is an
 *  Épure diagram carrying its own editable source. Using the registered
 *  `Software`/`Description` keywords means generic tools surface them too. */
export const PNG_MARKER_KEYS = {
  software: 'Software',
  description: 'Description',
} as const

const EPURE_SOFTWARE = 'Épure — @theodo-group/epure'

/** Plain-language note embedded in every rendered PNG so a reader handed only
 *  the image (a human, or an agent like Claude Code) knows it is an Épure
 *  diagram, that its editable source travels inside the file, and how to get it
 *  back — without needing to have seen the source repo or this skill first. */
const epureDescription = (hasLayout: boolean): string =>
  [
    'Architecture diagram made with Épure, a grid-snapped, git-reviewable diagram editor.',
    `Its editable source is embedded in this PNG as text chunks: "${PNG_SOURCE_KEYS.d2}" is the` +
      (hasLayout
        ? ` diagram topology and "${PNG_SOURCE_KEYS.layout}" is the layout.`
        : ' diagram topology.'),
    'Extract it with `npx -y @theodo-group/epure source <this-file.png>`,',
    'then edit the .epr.d2 / .epr.layout.json pair and open it live with',
    '`npx -y @theodo-group/epure <name>.epr.d2`.',
  ].join(' ')

/** The complete set of text chunks embedded in every rendered PNG: a
 *  self-describing marker (so the image announces "made with Épure, source
 *  inside, here's how to edit it") followed by the exact `.epr.d2` /
 *  `.epr.layout.json` bytes for a lossless round-trip back to the editable pair. */
export const epureMetaEntries = (
  d2: string,
  layoutText: string | null,
): { keyword: string; text: string }[] => [
  { keyword: PNG_MARKER_KEYS.software, text: EPURE_SOFTWARE },
  { keyword: PNG_MARKER_KEYS.description, text: epureDescription(layoutText !== null) },
  { keyword: PNG_SOURCE_KEYS.d2, text: d2 },
  ...(layoutText !== null ? [{ keyword: PNG_SOURCE_KEYS.layout, text: layoutText }] : []),
]

/** Splice the diagram's source (and the Épure marker) into an exported PNG blob,
 *  making it self-describing and round-trippable back to the editable pair. */
export const embedSourceInPngBlob = async (
  blob: Blob,
  d2: string,
  layoutText: string | null,
): Promise<Blob> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const out = embedPngText(bytes, epureMetaEntries(d2, layoutText))
  // Copy into a fresh ArrayBuffer-backed view so the Blob part is well-typed
  // (embedPngText's return may alias the input's ArrayBufferLike buffer).
  const part = new Uint8Array(out.length)
  part.set(out)
  return new Blob([part], { type: 'image/png' })
}
