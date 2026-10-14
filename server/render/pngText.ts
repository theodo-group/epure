// Node face of the PNG text-chunk codec. The implementation is shared with the
// browser (src/export/pngText.ts, plain Uint8Array); this only keeps the
// server's Buffer-in, Buffer-out signature.

import { embedPngText as embedPngBytes } from '../../src/export/pngText'

export {
  PNG_MARKER_KEYS,
  PNG_SOURCE_KEYS,
  epureMetaEntries,
  readPngText,
} from '../../src/export/pngText'

/** Return `png` with an `iTXt` chunk per entry spliced in after IHDR; a
 *  non-PNG input comes back as the very same buffer. */
export const embedPngText = (png: Buffer, entries: { keyword: string; text: string }[]): Buffer => {
  const out = embedPngBytes(png, entries)
  return out === png ? png : Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}
