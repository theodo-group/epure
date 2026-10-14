import { inlineSvgImages } from './inlineImages'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

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

// Pan/zoom for the exported page, inlined so the file stays self-contained. The
// view is the SVG's viewBox: it opens fitted to the diagram (the grid excluded),
// wheel / pinch / double-click zoom about the pointer, drag pans, and +/Fit/−
// buttons (or the +, - and 0 keys) mirror the editor. Zoom is bounded relative
// to the fitted view.
const PAN_ZOOM_SCRIPT = `(() => {
  const svg = document.querySelector('#epure-host > svg')
  if (!svg) return
  const MIN = 0.1, MAX = 20, PAD = 24
  const toUser = (x, y) => new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse())
  const fitBox = () => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    // The diagram's extent, without the background grid (it spans the editor's
    // viewport at export time): descend only into groups that contain it.
    const measure = (el) => {
      if (el.tagName === 'defs' || el.hasAttribute('data-ep-grid')) return
      if (el.querySelector('[data-ep-grid]')) {
        for (const child of el.children) measure(child)
        return
      }
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return
      const a = toUser(r.left, r.top), b = toUser(r.right, r.bottom)
      x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, b.x); y2 = Math.max(y2, b.y)
    }
    for (const el of svg.children) measure(el)
    if (!(x1 < x2)) return svg.viewBox.baseVal
    return { x: x1 - PAD, y: y1 - PAD, width: x2 - x1 + 2 * PAD, height: y2 - y1 + 2 * PAD }
  }
  const home = fitBox()
  let vb = { x: home.x, y: home.y, w: home.width, h: home.height }
  const apply = () => svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h)
  const fit = () => { vb = { x: home.x, y: home.y, w: home.width, h: home.height }; apply() }
  const zoomAt = (factor, cx, cy) => {
    const level = home.width / vb.w
    factor = Math.min(MAX, Math.max(MIN, level * factor)) / level
    const p = toUser(cx, cy)
    vb = { x: p.x - (p.x - vb.x) / factor, y: p.y - (p.y - vb.y) / factor, w: vb.w / factor, h: vb.h / factor }
    apply()
  }
  const center = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY)
  }, { passive: false })
  svg.addEventListener('dblclick', (e) => zoomAt(e.shiftKey ? 0.5 : 2, e.clientX, e.clientY))

  // Drag to pan; two pointers (touch) pinch-zoom about their midpoint.
  const pointers = new Map()
  let pinch = 0
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    svg.style.cursor = 'grabbing'
  })
  svg.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId)
    if (!last) return
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2) {
      const [[ax, ay], [bx, by]] = [...pointers.values()]
      const d = Math.hypot(ax - bx, ay - by)
      if (pinch) zoomAt(d / pinch, (ax + bx) / 2, (ay + by) / 2)
      pinch = d
      return
    }
    const m = svg.getScreenCTM()
    vb.x -= (e.clientX - last[0]) / m.a
    vb.y -= (e.clientY - last[1]) / m.d
    apply()
  })
  const release = (e) => {
    pointers.delete(e.pointerId)
    pinch = 0
    if (!pointers.size) svg.style.cursor = 'grab'
  }
  svg.addEventListener('pointerup', release)
  svg.addEventListener('pointercancel', release)

  const controls = document.createElement('div')
  controls.className = 'ep-pz'
  for (const [label, title, run] of [
    ['+', 'Zoom in', () => zoomAt(1.5, ...center())],
    ['Fit', 'Fit to screen', fit],
    ['\u2212', 'Zoom out', () => zoomAt(1 / 1.5, ...center())],
  ]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.addEventListener('click', run)
    controls.appendChild(b)
  }
  document.body.appendChild(controls)
  document.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.5, ...center())
    else if (e.key === '-') zoomAt(1 / 1.5, ...center())
    else if (e.key === '0') fit()
  })

  svg.style.cursor = 'grab'
  svg.style.touchAction = 'none'
  fit()
})()`

export const buildStandaloneHtml = (
  svgString: string,
  options: StandaloneHtmlOptions = {},
): string => {
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
  #epure-host > svg { width: 100%; height: 100%; user-select: none; }
  .ep-pz { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 2px; padding: 3px;
    background: #fff; border: 1px solid #ebe9e6; border-radius: 10px;
    box-shadow: 0 4px 16px rgba(28, 25, 23, 0.08); font: 13px system-ui, sans-serif; }
  .ep-pz button { min-width: 30px; height: 28px; padding: 0 8px; border: 0; border-radius: 7px;
    background: none; color: #1c1917; font: inherit; cursor: pointer; }
  .ep-pz button:hover { background: #f5f5f4; }
</style>
</head>
<body>
<div id="epure-host">
${svgString}
</div>
<script>${PAN_ZOOM_SCRIPT}</script>
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
