import { afterEach, describe, expect, it } from 'vitest'

import { BridgeClient } from './BridgeClient'
import { channel, host, unwrap, wrap } from './channel'
import type { BridgeConfig } from './config'
import { PROTOCOL_VERSION, type BridgeMsg, type FileFrame, type FileKind } from './protocol'

const HOST = 'http://host.test'

const cleanups: (() => void)[] = []

afterEach(() => {
  window.opener = null
  for (const dispose of cleanups.splice(0)) dispose()
})

/**
 * The host page, faked at the real boundary: a genuine (jsdom) iframe window
 * assigned to `window.opener`, its postMessage overridden to record. Inbound
 * frames travel the real event path (`window.dispatchEvent`), so listener
 * registration and removal are exercised for real, and `source` is a true
 * Window. No casts anywhere in this file.
 */
const makeHost = () => {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) throw new Error('jsdom did not create a contentWindow')
  cleanups.push(() => iframe.remove())
  const sent: { data: unknown; origin: string }[] = []
  Object.assign(win, {
    postMessage: (data: unknown, origin: string) => void sent.push({ data, origin }),
  })
  window.opener = win
  return {
    sent,
    /** Messages the app posted to us, unwrapped. */
    received: () => sent.map((m) => unwrap(m.data)),
    /** Deliver a message to the app as the host would. */
    post: (msg: BridgeMsg, over: { origin?: string; source?: MessageEventSource } = {}) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: over.origin ?? HOST,
          source: over.source ?? win,
          data: wrap(msg),
        }),
      )
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

const APPLIED: BridgeMsg = { type: 'applied', doc: 'sys', kinds: ['d2'] }

describe('wrap / unwrap', () => {
  it('round-trips a message; the wire shape is the one-key JSON-string envelope', () => {
    const payload = wrap(APPLIED)
    expect(payload).toEqual({ epureBridge: JSON.stringify(APPLIED) })
    expect(unwrap(payload)).toEqual(APPLIED)
  })

  it('rejects anything that is not bridge traffic', () => {
    expect(unwrap({ other: 'x' })).toBeNull()
    expect(unwrap('bare string')).toBeNull()
    expect(unwrap(null)).toBeNull()
    expect(unwrap({ epureBridge: 'not json' })).toBeNull()
    expect(unwrap({ epureBridge: JSON.stringify({ type: 'nonsense' }) })).toBeNull()
    expect(unwrap({ epureBridge: JSON.stringify(['no', 'type']) })).toBeNull()
  })
})

describe('channel', () => {
  it('sends frames to the host inside the envelope, targeted at its origin', () => {
    const page = makeHost()
    const socket = channel(HOST)
    socket.send(JSON.stringify(APPLIED))
    expect(page.sent).toEqual([{ data: wrap(APPLIED), origin: HOST }])
  })

  it('fires onopen asynchronously, after handlers are assigned', async () => {
    makeHost()
    const socket = channel(HOST)
    const opens: number[] = []
    socket.onopen = () => opens.push(1)
    expect(opens).toHaveLength(0)
    await tick()
    expect(opens).toHaveLength(1)
  })

  it('delivers only frames from the pinned origin AND the host window', () => {
    const page = makeHost()
    const socket = channel(HOST)
    const got: unknown[] = []
    socket.onmessage = (ev) => got.push(ev.data)
    page.post(APPLIED)
    page.post(APPLIED, { origin: 'http://evil.test' })
    page.post(APPLIED, { source: window })
    window.dispatchEvent(
      new MessageEvent('message', { origin: HOST, source: window.opener, data: { other: 'x' } }),
    )
    expect(got).toEqual([JSON.stringify(APPLIED)])
  })

  it('close() removes the real listener, and a pending onopen never fires', async () => {
    const page = makeHost()
    const socket = channel(HOST)
    const got: unknown[] = []
    socket.onopen = () => got.push('open')
    socket.onmessage = (ev) => got.push(ev.data)
    socket.close()
    page.post(APPLIED)
    await tick()
    expect(got).toEqual([])
  })

  it('reports a missing host as an immediate close (BridgeClient backoff takes over)', async () => {
    expect(host()).toBeNull()
    const socket = channel(HOST)
    const closes: number[] = []
    socket.onclose = () => closes.push(1)
    await tick()
    expect(closes).toHaveLength(1)
  })
})

// The real client over the real channel, with no injected factory: the pm
// config alone must select the transport. What the unit tests above can't see:
// that BridgeClient's handler-assignment order, hello envelope, hydrate
// dispatch and applied ack all survive the trip through postMessage.

const PM_CONFIG: BridgeConfig = {
  transport: 'pm',
  token: 'tok',
  protocol: PROTOCOL_VERSION,
  doc: 'sys',
  origin: HOST,
}

const D2 = 'a\nb\na -> b\n'

describe('BridgeClient over the channel', () => {
  it('handshake + apply round trip against a scripted host', async () => {
    const page = makeHost()
    const hydrates: { files: FileFrame[]; reconnect: boolean }[] = []
    const applied: FileKind[][] = []
    const statuses: string[] = []
    const client = new BridgeClient({
      config: PM_CONFIG,
      onHydrate: (files, reconnect) => hydrates.push({ files, reconnect }),
      onFileChanged: () => {},
      onStatus: (s) => statuses.push(s),
      onApplied: (kinds) => applied.push(kinds),
    })
    client.connect()
    // "open" is next-tick, so the hello can't outrun handler assignment.
    expect(page.sent).toEqual([])
    await tick()
    expect(statuses).toEqual(['connecting', 'connected'])
    expect(page.received()).toEqual([
      { type: 'hello', protocol: PROTOCOL_VERSION, token: 'tok', doc: 'sys' },
    ])

    page.post({
      type: 'hydrate',
      doc: 'sys',
      files: [
        { kind: 'd2', content: D2, valid: true },
        { kind: 'layout', content: null, valid: true },
      ],
    })
    expect(hydrates).toHaveLength(1)
    expect(hydrates[0]).toMatchObject({ reconnect: false })

    // A hydrate from the wrong origin never reaches the client.
    page.post({ type: 'hydrate', doc: 'sys', files: [] }, { origin: 'http://evil.test' })
    expect(hydrates).toHaveLength(1)

    expect(client.apply([{ kind: 'd2', content: `${D2}c\n` }]).sent).toEqual(['d2'])
    expect(page.received().at(-1)).toMatchObject({ type: 'apply', doc: 'sys' })
    page.post({ type: 'applied', doc: 'sys', kinds: ['d2'] })
    expect(applied).toEqual([['d2']])

    client.close()
  })

  it('a vanished host (popup whose opener is gone) lands in the normal reconnect path', async () => {
    // No makeHost(): window.opener is absent.
    const statuses: string[] = []
    const client = new BridgeClient({
      config: PM_CONFIG,
      backoffMs: [0],
      onHydrate: () => {},
      onFileChanged: () => {},
      onStatus: (s) => statuses.push(s),
    })
    client.connect()
    await tick()
    await tick()
    client.close()
    expect(statuses.slice(0, 3)).toEqual(['connecting', 'disconnected', 'connecting'])
  })
})
