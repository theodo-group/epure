// Inline every <image> in an SVG as a base64 data URI.
//
// Both export paths need this. An SVG rasterized through `new Image()` (the PNG
// path) runs in "secure static mode" and refuses to load external resources, so
// an <image> pointing at /icons/foo.png would silently render nothing — and a
// standalone HTML file opened from disk wouldn't find /icons/foo.png at all.
// Replacing the href with a self-contained data URI fixes both.

const XLINK_NS = 'http://www.w3.org/1999/xlink'

const blobToDataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })

const hrefOf = (el: Element): string | null =>
  el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href')

/**
 * Fetch each <image>'s href and rewrite it to a base64 data URI in place.
 * Already-inlined (`data:`) images are left untouched. Fetch failures are
 * swallowed so one missing icon can't abort the whole export.
 */
export const inlineSvgImages = async (svg: SVGSVGElement): Promise<void> => {
  const images = Array.from(svg.querySelectorAll('image'))
  if (images.length === 0) return

  const cache = new Map<string, Promise<string | null>>()
  const resolve = (href: string): Promise<string | null> => {
    let pending = cache.get(href)
    if (!pending) {
      pending = (async () => {
        try {
          const res = await fetch(href)
          if (!res.ok) return null
          return await blobToDataUri(await res.blob())
        } catch {
          return null
        }
      })()
      cache.set(href, pending)
    }
    return pending
  }

  await Promise.all(
    images.map(async (img) => {
      const href = hrefOf(img)
      if (!href || href.startsWith('data:')) return
      const dataUri = await resolve(href)
      if (!dataUri) return
      // Set both forms: `href` for modern renderers, `xlink:href` for the
      // SVG-as-image rasterizer used by the PNG export.
      img.setAttribute('href', dataUri)
      img.setAttributeNS(XLINK_NS, 'xlink:href', dataUri)
    }),
  )
}
