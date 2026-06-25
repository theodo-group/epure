import svgPanZoomSource from 'svg-pan-zoom/dist/svg-pan-zoom.min.js?raw'

import { inlineSvgImages } from './inlineImages'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

const escapeForScript = (src: string) =>
  src.replace(/<\/script>/gi, '<\\/script>')

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface StandaloneHtmlOptions {
  title?: string
}

const serializeSvg = async (svgEl: SVGSVGElement) => {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('xmlns:xlink', XLINK_NS)
  // Inline icon images so the exported file is fully self-contained.
  await inlineSvgImages(clone)
  return new XMLSerializer().serializeToString(clone)
}

export const buildStandaloneHtml = (
  svgString: string,
  options: StandaloneHtmlOptions = {},
): string => {
  const inlinedLib = escapeForScript(svgPanZoomSource)
  const title = escapeHtml(options.title ?? 'epure diagram')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #ffffff; }
  #epure-host { width: 100%; height: 100%; display: flex; }
  #epure-host > svg { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="epure-host">
${svgString}
</div>
<script>${inlinedLib}</script>
<script>
(function () {
  var host = document.getElementById('epure-host');
  if (!host) return;
  var svg = host.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('id', 'epure-svg');
  if (typeof svgPanZoom === 'function') {
    svgPanZoom('#epure-svg', {
      zoomEnabled: true,
      controlIconsEnabled: true,
      fit: true,
      center: true,
      minZoom: 0.1,
      maxZoom: 20,
    });
  }
})();
</script>
</body>
</html>
`
}

export const exportStandaloneHtml = async (
  svgEl: SVGSVGElement,
  options: StandaloneHtmlOptions = {},
): Promise<string> => {
  return buildStandaloneHtml(await serializeSvg(svgEl), options)
}
