// Headless diagram rendering: pair text in, fit-to-content SVG or PNG out,
// the editor's exact look, no browser. `epure export` runs on this so Claude
// Code can see the rendered diagram; hosts get it as
// `@theodo-group/epure/render`.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DiagramModel, DiagramOptions } from '../../src/renderer/Diagram'
import { model } from './model'
import { svgToPng, type PngOptions } from './png'
import { PNG_SOURCE_KEYS, embedPngText, epureMetaEntries, readPngText } from './pngText'
import { inlineIcons, renderSvgString } from './svg'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the icon images shipped with the package. */
export const packagedIconsDir = (): string => {
  // Bundled (dist-lib/ or dist-server/): ../dist/icons. From source: public/.
  const candidates = [
    join(HERE, '..', 'dist', 'icons'),
    join(HERE, '..', 'public', 'icons'),
    join(HERE, '..', '..', 'public', 'icons'),
  ]
  return candidates.find(existsSync) ?? candidates[0]!
}

export interface RenderOptions extends DiagramOptions, PngOptions {
  /** Icon handling: an alternate icons directory, or false to leave the
   *  `/icons/...` hrefs untouched. Default: the icons shipped with the
   *  package, base64-inlined. */
  icons?: string | false
}

/** Render a pair to a fit-to-content SVG string, or `{ error }` if the d2 is
 *  invalid. */
export const svg = async (
  d2: string,
  layoutText: string | null,
  opts: RenderOptions = {},
): Promise<string | { error: string }> => {
  const built = await model(d2, layoutText)
  if ('error' in built) return built
  const markup = renderSvgString(built, opts)
  const icons = opts.icons === false ? null : (opts.icons ?? packagedIconsDir())
  return icons ? inlineIcons(markup, icons) : markup
}

/** Render a pair to fit-to-content PNG bytes, or `{ error }` if the d2 is
 *  invalid. The diagram's own source (d2 + layout) is embedded as PNG text
 *  metadata, alongside a self-describing "made with Épure, source inside"
 *  marker, so the image is a self-contained, round-trippable, agent-readable
 *  record of the pair; `source()` reads it back. */
export const png = async (
  d2: string,
  layoutText: string | null,
  opts: RenderOptions = {},
): Promise<Buffer | { error: string }> => {
  const markup = await svg(d2, layoutText, opts)
  if (typeof markup !== 'string') return markup
  return embedPngText(svgToPng(markup, opts), epureMetaEntries(d2, layoutText))
}

/** Recover the editable pair from any Épure-rendered PNG, or null when the
 *  bytes carry no embedded source (not an Épure image). */
export const source = (bytes: Buffer): { d2: string; layout: string | null } | null => {
  const meta = readPngText(bytes)
  const d2 = meta[PNG_SOURCE_KEYS.d2]
  if (d2 === undefined) return null
  return { d2, layout: meta[PNG_SOURCE_KEYS.layout] ?? null }
}

export { model }
export type { DiagramModel, DiagramOptions }
