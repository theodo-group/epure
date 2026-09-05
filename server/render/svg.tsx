// Server binding for the Diagram component: SSR it to an SVG string, then
// inline the icon PNGs as data URIs (a rasterizer can't fetch `/icons/...`).
// The drawing itself, bounds included, lives in src/renderer/Diagram.tsx.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'

import { Diagram, type DiagramModel, type DiagramOptions } from '../../src/renderer/Diagram'

/** SSR the model to an SVG string sized exactly to its content. */
export const renderSvgString = (model: DiagramModel, opts: DiagramOptions = {}): string =>
  renderToStaticMarkup(<Diagram model={model} padding={opts.padding} background={opts.background} />)

/**
 * Replace `href="/icons/<file>"` (or `xlink:href`) with inlined base64 data
 * URIs so the rasterizer renders the logos. Unknown/missing files are left
 * untouched (the rasterizer simply skips a broken href).
 */
export const inlineIcons = (svg: string, iconsDir: string): string =>
  svg.replace(/(xlink:href|href)="\/icons\/([^"]+)"/g, (whole, attr: string, file: string) => {
    try {
      const bytes = readFileSync(join(iconsDir, file))
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
      return `${attr}="data:${mime};base64,${bytes.toString('base64')}"`
    } catch {
      return whole
    }
  })
