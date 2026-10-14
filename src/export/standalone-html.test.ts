// @vitest-environment jsdom
// The exported page is run, not read: its inline pan/zoom script executes
// against the page's own DOM and the assertions are on the viewBox it drives.
// jsdom has no layout, so the geometry the script measures is stubbed: the
// viewport is 1000×800 at the origin with screen px = user units, and each
// shape's box comes from its attributes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildStandaloneHtml } from './standalone-html'

const SVG = `<svg viewBox="0 0 10 10">
  <defs><marker id="m"><rect width="999" height="999"/></marker></defs>
  <g>
    <g data-ep-grid="1"><rect x="-5000" y="-5000" width="10000" height="10000"/></g>
    <rect x="10" y="20" width="40" height="30"/>
  </g>
</svg>`

// The diagram's extent (10,20 → 50,50) padded by 24 on every side.
const FIT = { x: -14, y: -4, w: 88, h: 78 }

const box = (el: Element): DOMRect => {
  if (el.tagName === 'svg') return DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 800 })
  const n = (a: string) => Number(el.getAttribute(a) ?? 0)
  if (el.tagName === 'rect') {
    return DOMRect.fromRect({ x: n('x'), y: n('y'), width: n('width'), height: n('height') })
  }
  const rects = [...el.children].map(box).filter((r) => r.width || r.height)
  if (!rects.length) return DOMRect.fromRect()
  const x = Math.min(...rects.map((r) => r.left))
  const y = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return DOMRect.fromRect({ x, y, width: right - x, height: bottom - y })
}

class IdentityPoint {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  matrixTransform() {
    return { x: this.x, y: this.y }
  }
}
const IDENTITY = { a: 1, d: 1, inverse: () => IDENTITY }

const openExport = (title?: string) => {
  const html = buildStandaloneHtml(SVG, title === undefined ? {} : { title })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const svg = doc.querySelector('#epure-host > svg') as SVGSVGElement
  Object.assign(svg, { getScreenCTM: () => IDENTITY, setPointerCapture: () => {} })
  // Execute the page's own script(s) against its document.
  for (const script of doc.querySelectorAll('script')) {
    new Function('document', 'DOMPoint', script.textContent ?? '')(doc, IdentityPoint)
  }
  const viewBox = () => {
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number)
    return { x: x!, y: y!, w: w!, h: h! }
  }
  const key = (k: string) => doc.dispatchEvent(new KeyboardEvent('keydown', { key: k }))
  const button = (title: string) =>
    (doc.querySelector(`.ep-pz button[title="${title}"]`) as HTMLButtonElement).click()
  return { doc, svg, viewBox, key, button }
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return box(this)
  })
})
afterEach(() => vi.restoreAllMocks())

describe('buildStandaloneHtml', () => {
  it('embeds the diagram under an escaped title, with no external script', () => {
    // The title is the diagram's name — user text that must not close <title>.
    const title = 'a </title><script src="x.js"></script><b> & c'
    const { doc, svg } = openExport(title)
    expect(doc.title).toBe(title)
    expect(doc.querySelector('b')).toBeNull()
    expect(svg.querySelector('rect[x="10"][y="20"]')).not.toBeNull()
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelectorAll('script[src], link[rel="stylesheet"]')).toHaveLength(0)
  })

  it('opens fitted to the diagram, ignoring the background grid and defs', () => {
    const { viewBox } = openExport()
    expect(viewBox()).toEqual(FIT)
  })

  it('zooms about the centre with + / − and returns to the fit with 0', () => {
    const { viewBox, key } = openExport()
    key('+')
    const zoomed = viewBox()
    expect(zoomed.w).toBeCloseTo(FIT.w / 1.5)
    expect(zoomed.h).toBeCloseTo(FIT.h / 1.5)
    // The viewport centre (500, 400) stays put under the zoom.
    expect(zoomed.x).toBeCloseTo(500 - (500 - FIT.x) / 1.5)
    key('-')
    expect(viewBox().w).toBeCloseTo(FIT.w)
    key('+')
    key('0')
    expect(viewBox()).toEqual(FIT)
  })

  it('zooms in on wheel up and out on wheel down', () => {
    const { svg, viewBox } = openExport()
    const wheel = (deltaY: number) =>
      svg.dispatchEvent(
        new WheelEvent('wheel', { deltaY, clientX: 30, clientY: 35, cancelable: true }),
      )
    expect(wheel(-100)).toBe(false) // the page does not scroll
    const zoomedIn = viewBox()
    expect(zoomedIn.w).toBeLessThan(FIT.w)
    wheel(200)
    expect(viewBox().w).toBeGreaterThan(FIT.w)
  })

  it('bounds the zoom to 20× in and 10× out of the fitted view', () => {
    const { viewBox, key, button } = openExport()
    for (let i = 0; i < 30; i += 1) key('+')
    expect(viewBox().w).toBeCloseTo(FIT.w / 20)
    for (let i = 0; i < 30; i += 1) button('Zoom out')
    expect(viewBox().w).toBeCloseTo(FIT.w / 0.1)
    button('Fit to screen')
    expect(viewBox()).toEqual(FIT)
  })
})
