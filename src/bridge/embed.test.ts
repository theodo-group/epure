import { afterEach, describe, expect, it } from 'vitest'

import { unwrap, wrap } from './channel'
import { advance, embed } from './embed'
import type { BridgeMsg, FileKind } from './protocol'

const state = (over: Partial<Parameters<typeof advance>[0]> = {}) => ({
  token: 'nonce-1',
  doc: 'el-42',
  files: { d2: 'web -> api', layout: '{"nodes":{}}' },
  dirty: false,
  connected: false,
  ...over,
})

/** Wire a test value in exactly as production would receive it. */
const msg = (value: unknown): BridgeMsg => {
  const parsed = unwrap({ epureBridge: JSON.stringify(value) })
  if (parsed === null) throw new Error('test message did not survive unwrap')
  return parsed
}

const hello = (over: Record<string, unknown> = {}): BridgeMsg =>
  msg({ type: 'hello', protocol: 1, token: 'nonce-1', doc: 'el-42', ...over })

const apply = (files: unknown): BridgeMsg => msg({ type: 'apply', doc: 'el-42', files })

describe('advance: hello', () => {
  it('a good hello hydrates with the current pair and connects', () => {
    const { state: next, replies } = advance(state(), hello())
    expect(next.connected).toBe(true)
    expect(next.dirty).toBe(false)
    expect(replies).toEqual([
      {
        type: 'hydrate',
        doc: 'el-42',
        files: [
          { kind: 'd2', content: 'web -> api', valid: true },
          { kind: 'layout', content: '{"nodes":{}}', valid: true },
        ],
      },
    ])
  })

  it('an absent layout hydrates as content null', () => {
    const { replies } = advance(state({ files: { d2: 'web -> api', layout: null } }), hello())
    expect(replies[0]).toMatchObject({
      files: [
        { kind: 'd2', content: 'web -> api', valid: true },
        { kind: 'layout', content: null, valid: true },
      ],
    })
  })

  it('a bad or missing token is rejected as unauthorized, state untouched', () => {
    const before = state()
    const stolen = advance(before, hello({ token: 'stolen' }))
    expect(stolen.state).toBe(before)
    expect(stolen.replies).toEqual([{ type: 'rejected', doc: 'el-42', reason: 'unauthorized' }])
    expect(advance(before, hello({ token: undefined })).replies).toEqual([
      { type: 'rejected', doc: 'el-42', reason: 'unauthorized' },
    ])
  })

  it('a wrong protocol is rejected as protocol, with the fix named', () => {
    const { state: next, replies } = advance(state(), hello({ protocol: 99 }))
    expect(next.connected).toBe(false)
    expect(replies[0]).toMatchObject({ type: 'rejected', reason: 'protocol' })
  })
})

describe('advance: apply', () => {
  it('records the kinds, marks dirty and acks', () => {
    const { state: next, replies, changed } = advance(
      state({ connected: true }),
      apply([
        { kind: 'd2', content: 'web -> api -> db' },
        { kind: 'layout', content: '{"nodes":{"db":[1,2]}}' },
      ]),
    )
    expect(next.files).toEqual({ d2: 'web -> api -> db', layout: '{"nodes":{"db":[1,2]}}' })
    expect(next.dirty).toBe(true)
    expect(changed).toEqual(['d2', 'layout'])
    expect(replies).toEqual([{ type: 'applied', doc: 'el-42', kinds: ['d2', 'layout'] }])
  })

  it('a single-kind apply leaves the other kind alone', () => {
    const { state: next } = advance(state(), apply([{ kind: 'layout', content: '{}' }]))
    expect(next.files).toEqual({ d2: 'web -> api', layout: '{}' })
  })

  it('re-hello after an apply hydrates with the APPLIED content, still dirty', () => {
    const applied = advance(state(), apply([{ kind: 'd2', content: 'a -> b' }]))
    const { state: next, replies } = advance(applied.state, hello())
    expect(replies[0]).toMatchObject({
      files: [
        { kind: 'd2', content: 'a -> b', valid: true },
        { kind: 'layout', content: '{"nodes":{}}', valid: true },
      ],
    })
    expect(next.dirty).toBe(true)
  })

  it('malformed entries are skipped; only the well-formed kinds count', () => {
    const { state: next, replies } = advance(
      state(),
      apply([
        { kind: 'png', content: 'nope' },
        { kind: 'd2', content: null },
        { kind: 'd2', content: 'kept' },
      ]),
    )
    expect(next.files.d2).toBe('kept')
    expect(next.dirty).toBe(true)
    expect(replies[0]).toMatchObject({ kinds: ['d2'] })
  })

  it('an apply whose files is not a list is ignored', () => {
    const before = state()
    expect(advance(before, apply(3))).toEqual({ state: before, replies: [], changed: [] })
  })

  it('server-role messages echoed back are ignored', () => {
    const before = state()
    const echoed = msg({ type: 'applied', doc: 'el-42', kinds: ['d2'] })
    expect(advance(before, echoed)).toEqual({ state: before, replies: [], changed: [] })
  })
})

// The DOM binding, against a real jsdom iframe (same pattern as channel.test):
// embed sets the src, the "editor" answers through the real event path.

const APP = 'https://app.test/epure/'
const APP_ORIGIN = 'https://app.test'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
})

const makeEditor = () => {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  cleanups.push(() => iframe.remove())
  const sent: unknown[] = []
  const record = () => {
    const win = iframe.contentWindow
    if (!win) throw new Error('jsdom did not create a contentWindow')
    Object.assign(win, { postMessage: (data: unknown) => void sent.push(data) })
  }
  const speak = (m: BridgeMsg, origin = APP_ORIGIN) => {
    window.dispatchEvent(
      new MessageEvent('message', { origin, source: iframe.contentWindow, data: wrap(m) }),
    )
  }
  const tokenOf = () => {
    const token = new URLSearchParams(new URL(iframe.src).hash.replace(/^#/, '')).get('token')
    if (!token) throw new Error('no token in iframe.src')
    return token
  }
  return { iframe, record, speak, tokenOf, replies: () => sent.map(unwrap) }
}

describe('embed', () => {
  it('boots the editor on a bridgeUrl of its own minting', () => {
    const editor = makeEditor()
    const session = embed(editor.iframe, { app: APP, doc: 'sys', files: { d2: 'a' } })
    const params = new URLSearchParams(new URL(editor.iframe.src).hash.replace(/^#/, ''))
    expect(editor.iframe.src.startsWith(APP)).toBe(true)
    expect(params.get('bridge')).toBe('pm')
    expect(params.get('doc')).toBe('sys')
    expect(params.get('origin')).toBe(window.location.origin)
    expect(params.get('token')).toBeTruthy()
    expect(session.dirty()).toBe(false)
    session.close()
  })

  it('handshake and edits round-trip; files()/dirty() track the session', () => {
    const editor = makeEditor()
    const changes: { files: { d2: string; layout: string | null }; changed: FileKind[] }[] = []
    let connects = 0
    const session = embed(editor.iframe, {
      app: APP,
      doc: 'sys',
      files: { d2: 'a', layout: null },
      onChange: (files, changed) => changes.push({ files, changed }),
      onConnect: () => connects++,
    })
    editor.record()
    editor.speak(msg({ type: 'hello', protocol: 1, token: editor.tokenOf(), doc: 'sys' }))
    expect(connects).toBe(1)
    expect(editor.replies()).toEqual([
      {
        type: 'hydrate',
        doc: 'sys',
        files: [
          { kind: 'd2', content: 'a', valid: true },
          { kind: 'layout', content: null, valid: true },
        ],
      },
    ])

    editor.speak(msg({ type: 'apply', doc: 'sys', files: [{ kind: 'd2', content: 'a -> b' }] }))
    expect(session.files()).toEqual({ d2: 'a -> b', layout: null })
    expect(session.dirty()).toBe(true)
    expect(changes).toEqual([{ files: { d2: 'a -> b', layout: null }, changed: ['d2'] }])
    expect(editor.replies().at(-1)).toEqual({ type: 'applied', doc: 'sys', kinds: ['d2'] })
    session.close()
  })

  it('drops frames from the wrong origin, and everything after close()', () => {
    const editor = makeEditor()
    const session = embed(editor.iframe, { app: APP, doc: 'sys', files: { d2: 'a' } })
    editor.record()
    const helloMsg = msg({ type: 'hello', protocol: 1, token: editor.tokenOf(), doc: 'sys' })
    editor.speak(helloMsg, 'https://evil.test')
    expect(editor.replies()).toEqual([])
    session.close()
    editor.speak(helloMsg)
    expect(editor.replies()).toEqual([])
  })
})
