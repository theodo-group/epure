import { afterEach, describe, expect, it, vi } from 'vitest'

import { inlineSvgImages } from '@/export/inlineImages'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

const makeSvg = (hrefs: string[]): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  for (const href of hrefs) {
    const img = document.createElementNS(SVG_NS, 'image')
    img.setAttribute('href', href)
    svg.appendChild(img)
  }
  return svg
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('inlineSvgImages', () => {
  it('rewrites external image hrefs to base64 data URIs (href + xlink:href)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const svg = makeSvg(['/icons/aws/compute/ec2.png'])
    await inlineSvgImages(svg)

    const img = svg.querySelector('image')!
    expect(img.getAttribute('href')).toMatch(/^data:image\/png;base64,/)
    expect(img.getAttributeNS(XLINK_NS, 'href')).toMatch(/^data:image\/png;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves already-inlined data URIs untouched and never fetches them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const original = 'data:image/png;base64,AAAA'
    const svg = makeSvg([original])
    await inlineSvgImages(svg)

    expect(svg.querySelector('image')!.getAttribute('href')).toBe(original)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches each distinct href once, even when reused', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const svg = makeSvg(['/icons/a.png', '/icons/a.png', '/icons/b.png'])
    await inlineSvgImages(svg)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('swallows fetch failures and leaves that href as-is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const svg = makeSvg(['/icons/missing.png'])
    await expect(inlineSvgImages(svg)).resolves.toBeUndefined()
    expect(svg.querySelector('image')!.getAttribute('href')).toBe('/icons/missing.png')
  })
})
