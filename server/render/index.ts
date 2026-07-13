// Headless diagram → PNG/SVG, fit to content. Used by `epure export` so Claude
// Code can *see* the rendered diagram (the editor's exact look) without any
// browser. The output is always framed to the diagram's content bounds.

import { buildRenderModel } from './model'
import { svgToPng, type PngOptions } from './png'
import { embedPngText, PNG_SOURCE_KEYS } from './pngText'
import { inlineIcons, renderSvgString, type SvgOptions } from './svg'

export interface RenderOptions extends SvgOptions, PngOptions {
  /** Directory holding the icon PNGs (`<iconsDir>/aws/.../x.png`). */
  iconsDir?: string
}

/** Render a pair to a fit-to-content SVG string, or `{ error }` if the d2 is invalid. */
export const renderDiagramSvg = async (
  d2: string,
  layoutText: string | null,
  opts: RenderOptions = {},
): Promise<string | { error: string }> => {
  const model = await buildRenderModel(d2, layoutText)
  if ('error' in model) return model
  const svg = renderSvgString(model, opts)
  return opts.iconsDir ? inlineIcons(svg, opts.iconsDir) : svg
}

/** Render a pair to fit-to-content PNG bytes, or `{ error }` if the d2 is
 *  invalid. The diagram's own source (d2 + layout) is embedded as PNG text
 *  metadata so the image is a self-contained, round-trippable record. */
export const renderDiagramPng = async (
  d2: string,
  layoutText: string | null,
  opts: RenderOptions = {},
): Promise<Buffer | { error: string }> => {
  const svg = await renderDiagramSvg(d2, layoutText, opts)
  if (typeof svg !== 'string') return svg
  const png = svgToPng(svg, opts)
  return embedPngText(png, [
    { keyword: PNG_SOURCE_KEYS.d2, text: d2 },
    ...(layoutText !== null ? [{ keyword: PNG_SOURCE_KEYS.layout, text: layoutText }] : []),
  ])
}

export { buildRenderModel } from './model'
export { renderSvgString, inlineIcons } from './svg'
export { svgToPng } from './png'
export { embedPngText, readPngText, PNG_SOURCE_KEYS } from './pngText'
