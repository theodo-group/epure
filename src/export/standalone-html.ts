// TODO: replace with the actual svg-pan-zoom UMD source string, inlined at
// build time (e.g. via a Vite plugin or an `?raw` import of
// node_modules/svg-pan-zoom/dist/svg-pan-zoom.min.js). For now this placeholder
// keeps the export shape stable; the produced HTML will render the SVG but
// pan/zoom will be a no-op until the source is wired in.
const SVG_PAN_ZOOM_SOURCE = ''

const escapeForScript = (src: string) => src.replace(/<\/script>/gi, '<\\/script>')

export const buildStandaloneHtml = (svgString: string): string => {
  const inlinedLib = escapeForScript(SVG_PAN_ZOOM_SOURCE)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>archgrid diagram</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #ffffff; }
  #archgrid-host { width: 100%; height: 100%; display: flex; }
  #archgrid-host > svg { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="archgrid-host">
${svgString}
</div>
<script>${inlinedLib}</script>
<script>
(function () {
  var host = document.getElementById('archgrid-host');
  if (!host) return;
  var svg = host.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('id', 'archgrid-svg');
  if (typeof svgPanZoom === 'function') {
    svgPanZoom('#archgrid-svg', {
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
