// Rasterize an SVG string to PNG bytes with resvg (pure Rust, no browser). The
// SVG already carries its content-sized width/height, so a fit-to-content
// export needs no viewport math here — `scale` just multiplies the resolution.

import { Resvg } from '@resvg/resvg-js'

export interface PngOptions {
  /** Resolution multiplier (1 = SVG's intrinsic px). */
  scale?: number
  background?: string
}

export const svgToPng = (svg: string, opts: PngOptions = {}): Buffer => {
  const scale = opts.scale ?? 2
  const resvg = new Resvg(svg, {
    background: opts.background ?? '#ffffff',
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale },
    // The diagram's text was laid out with approximate metrics, so any clean
    // sans-serif is fine; load whatever the host has and fall back to a generic.
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  })
  return resvg.render().asPng()
}
