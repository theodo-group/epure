// Headless diagram → PNG/SVG, fit to content. Used by `epure export` so Claude
// Code can *see* the rendered diagram (the editor's exact look) without any
// browser. The output is always framed to the diagram's content bounds.

import { buildRenderModel } from './model'
import { svgToPng, type PngOptions } from './png'
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

/** Render a pair to fit-to-content PNG bytes, or `{ error }` if the d2 is invalid. */
export const renderDiagramPng = async (
  d2: string,
  layoutText: string | null,
  opts: RenderOptions = {},
): Promise<Buffer | { error: string }> => {
  const svg = await renderDiagramSvg(d2, layoutText, opts)
  if (typeof svg !== 'string') return svg
  return svgToPng(svg, opts)
}

export { buildRenderModel } from './model'
export { renderSvgString, inlineIcons } from './svg'
export { svgToPng } from './png'
