// injectBridge puts user-controlled strings (the diagram's file name and path)
// inside an inline <script>. Whatever they contain, the page must keep exactly
// one script element, and evaluating it must hand the SPA the same values.

import { describe, expect, it } from 'vitest'

import { type BridgeRuntime, injectBridge } from './inject'

const PAGE = '<!doctype html><html><head><title>Épure</title></head><body></body></html>'

const runtime = (over: Partial<BridgeRuntime> = {}): BridgeRuntime => ({
  doc: 'system',
  file: '/repo/system.epr.d2',
  token: 'tok',
  version: '1.0.0',
  ...over,
})

// What the browser's tokenizer does with the injected tag: a script element's
// text ends at the first `</script` (any case), so count where those occur.
const scriptCloses = (html: string) => html.match(/<\/script/gi)?.length ?? 0

// Evaluate the injected script body the way the browser would, in a sandbox.
const evaluate = (html: string) => {
  const body = /<script>([\s\S]*?)<\/script>/i.exec(html)![1]!
  const window: { __EPURE_BRIDGE__?: Record<string, unknown> } = {}
  new Function('window', body)(window)
  return window.__EPURE_BRIDGE__!
}

describe('injectBridge', () => {
  it('exposes the session to the SPA before </head>', () => {
    const html = injectBridge(PAGE, runtime())
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'))
    expect(evaluate(html)).toMatchObject({
      token: 'tok',
      doc: 'system',
      file: '/repo/system.epr.d2',
      version: '1.0.0',
    })
  })

  it('cannot be broken out of by a hostile doc or file name', () => {
    const doc = '</script><script>alert(1)</script>'
    const file = '/tmp/</SCRIPT ><!--x.epr.d2'
    const html = injectBridge(PAGE, runtime({ doc, file }))
    expect(scriptCloses(html)).toBe(1)
    expect(html).not.toContain('<!--')
    expect(evaluate(html)).toMatchObject({ doc, file })
  })

  it('keeps U+2028/U+2029 in a name from ending the script source', () => {
    const doc = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`
    const html = injectBridge(PAGE, runtime({ doc }))
    for (const sep of [0x2028, 0x2029]) expect(html).not.toContain(String.fromCharCode(sep))
    expect(evaluate(html).doc).toBe(doc)
  })

  it('still injects into a page without a head', () => {
    const html = injectBridge('<p>hi</p>', runtime())
    expect(html.endsWith('<p>hi</p>')).toBe(true)
    expect(evaluate(html).token).toBe('tok')
  })
})
