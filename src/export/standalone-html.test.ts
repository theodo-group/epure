import { describe, expect, it } from 'vitest'

import { buildStandaloneHtml } from './standalone-html'

describe('buildStandaloneHtml', () => {
  const html = buildStandaloneHtml('<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>', {
    title: 'a <b> & c',
  })

  it('embeds the diagram and an escaped title', () => {
    expect(html).toContain('<svg viewBox="0 0 10 10">')
    expect(html).toContain('<title>a &lt;b&gt; &amp; c</title>')
  })

  it('inlines its own pan/zoom (no third-party script, no network)', () => {
    expect(html).not.toMatch(/svgPanZoom|<script src=/)
    expect(html).toContain("document.querySelector('#epure-host > svg')")
    expect(html.match(/<script>/g)).toHaveLength(1)
  })
})
