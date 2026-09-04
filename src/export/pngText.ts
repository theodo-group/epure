// Browser twin of `server/render/pngText.ts`. The editor's "Export PNG" button
// rasterizes via canvas, which strips metadata — so we splice the diagram's own
// source (and a self-describing "made with Épure" marker) back into the PNG
// bytes here. The result is the same self-contained, agent-readable record the
// headless `epure export` writes: hand the image to Claude Code and it can
// recover the editable pair with `epure source <file.png>`.
//
// Small and dependency-free on purpose; the chunk format (iTXt, UTF-8) matches
// the server byte-for-byte so `readPngText` / `epure source` round-trip it.
// Keep `epureMetaEntries` in sync with its server twin.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// CRC-32/ISO-HDLC (the PNG/zlib variant), same table as the server.
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
 *  (or empty-entries) input is returned untouched. Mirror of the server's
 *  `embedPngText`. */
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

/** Keywords under which the diagram source is stored — mirror of the server's
 *  `PNG_SOURCE_KEYS`. */
export const PNG_SOURCE_KEYS = {
  d2: 'epure.d2',
  layout: 'epure.layout.json',
} as const

const EPURE_SOFTWARE = 'Épure — @theodo-group/epure'

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

/** The marker + source chunks embedded in an exported PNG. Kept in sync with
 *  `epureMetaEntries` in `server/render/pngText.ts`. */
export const epureMetaEntries = (
  d2: string,
  layoutText: string | null,
): { keyword: string; text: string }[] => [
  { keyword: 'Software', text: EPURE_SOFTWARE },
  { keyword: 'Description', text: epureDescription(layoutText !== null) },
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
