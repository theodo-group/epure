import { inlineSvgImages } from './inlineImages'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

const parseViewBox = (vb: string | null) => {
  if (!vb) return null
  const parts = vb.trim().split(/\s+|,/).map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null
  return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! }
}

const measure = (svgEl: SVGSVGElement) => {
  const vb = parseViewBox(svgEl.getAttribute('viewBox'))
  if (vb) return { width: vb.w, height: vb.h }

  const rect = svgEl.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }
  return { width: 800, height: 600 }
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (err) => reject(err)
    img.src = url
  })

/** A content-space rectangle (user units) to reframe the export to. */
export interface ExportFrame {
  x: number
  y: number
  w: number
  h: number
}

// Reframe the clone to `frame` so the export is a fitted view of the whole
// diagram, independent of the editor's current pan/zoom. The editor-only chrome
// (background grid, feedback overlay) is stripped and a white backdrop laid down
// so the result matches the headless CLI export rather than the live viewport.
const applyFrame = (clone: SVGSVGElement, frame: ExportFrame) => {
  clone.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`)
  clone
    .querySelectorAll('[data-ep-grid],[data-feedback-layer]')
    .forEach((el) => el.remove())
  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', String(frame.x))
  bg.setAttribute('y', String(frame.y))
  bg.setAttribute('width', String(frame.w))
  bg.setAttribute('height', String(frame.h))
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)
}

export const exportPng = async (
  svgEl: SVGSVGElement,
  scale: 1 | 2 | 4,
  frame?: ExportFrame,
): Promise<Blob> => {
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    await document.fonts.ready
  }

  const { width, height } = frame
    ? { width: frame.w, height: frame.h }
    : measure(svgEl)
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('xmlns:xlink', XLINK_NS)
  if (frame) applyFrame(clone, frame)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  // Inline icon images as data URIs — a rasterized SVG can't fetch externals.
  await inlineSvgImages(clone)

  const serialized = new XMLSerializer().serializeToString(clone)
  const svgString = serialized.startsWith('<?xml')
    ? serialized
    : `<?xml version="1.0" standalone="no"?>\n${serialized}`

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire 2D rendering context')

    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('canvas.toBlob returned null'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
