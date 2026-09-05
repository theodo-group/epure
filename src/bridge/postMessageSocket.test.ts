import { afterEach, describe, expect, it } from 'vitest'

import { BridgeClient } from './BridgeClient'
import type { BridgeConfig } from './config'
import { PM_ENVELOPE_KEY, makePmSocketFactory, readPmFrame } from './postMessageSocket'
import { PROTOCOL_VERSION, type FileFrame, type FileKind } from './protocol'

const HOST = 'http://host.test'

/**
 * The one fake in this file: the host window. It IS the boundary — another
 * browsing context on another origin, which jsdom cannot instantiate for real.
 * Everything on our side runs for real: `addEventListener` registration, event
 * delivery via `window.dispatchEvent`, and (in the integration block) the real
 * `BridgeClient` — so `close()` is proven to detach the actual listener, not
 * just flip a flag.
 */
const makeHost = () => {
  const host = {
    sent: [] as { data: unknown; origin: string }[],
    postMessage(data: unknown, origin: string) {
      host.sent.push({ data, origin })
    },
    /** Frames the app posted to us, unwrapped and parsed. */
    frames: () => host.sent.map((m) => JSON.parse(readPmFrame(m.data) ?? 'null') as object),
    /** Deliver a frame to the app through the real event path. */
    post: (msg: object, over: { origin?: string; source?: unknown } = {}) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: over.origin ?? HOST,
          source: (over.source ?? host) as unknown as MessageEventSource,
          data: { [PM_ENVELOPE_KEY]: JSON.stringify(msg) },
        }),
      )
    },
  }
  ;(window as unknown as { opener: unknown }).opener = host
  return host
}

const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  delete (window as unknown as { opener?: unknown }).opener
})

describe('readPmFrame', () => {
  it('unwraps the envelope and rejects everything else', () => {
    expect(readPmFrame({ [PM_ENVELOPE_KEY]: '{"type":"hello"}' })).toBe('{"type":"hello"}')
    expect(readPmFrame({ other: 'x' })).toBeNull()
    expect(readPmFrame('bare string')).toBeNull()
    expect(readPmFrame(null)).toBeNull()
  })
})

describe('makePmSocketFactory', () => {
  it('sends frames to the peer wrapped in the envelope, targeted at its origin', () => {
    const host = makeHost()
    const socket = makePmSocketFactory(HOST)('ignored-url')
    socket.send('{"type":"hello"}')
    expect(host.sent).toEqual([{ data: { [PM_ENVELOPE_KEY]: '{"type":"hello"}' }, origin: HOST }])
  })

  it('fires onopen asynchronously, after handlers are assigned', async () => {
    makeHost()
    const socket = makePmSocketFactory(HOST)('ignored-url')
    const opens: number[] = []
    socket.onopen = () => opens.push(1)
    expect(opens).toHaveLength(0)
    await tick()
    expect(opens).toHaveLength(1)
  })

  it('delivers only frames from the pinned origin AND the peer window', () => {
    const host = makeHost()
    const socket = makePmSocketFactory(HOST)('ignored-url')
    const got: unknown[] = []
    socket.onmessage = (ev) => got.push(ev.data)
    host.post({ type: 'good' })
    host.post({ type: 'evil' }, { origin: 'http://evil.test' })
    host.post({ type: 'spoof' }, { source: { postMessage: () => {} } })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: HOST,
        source: host as unknown as MessageEventSource,
        data: { other: 'not ours' },
      }),
    )
    expect(got).toEqual(['{"type":"good"}'])
  })

  it('close() detaches the real listener, and a pending onopen never fires', async () => {
    const host = makeHost()
    const socket = makePmSocketFactory(HOST)('ignored-url')
    const got: unknown[] = []
    socket.onopen = () => got.push('open')
    socket.onmessage = (ev) => got.push(ev.data)
    socket.close()
    host.post({ type: 'late' })
    await tick()
    expect(got).toEqual([])
  })

  it('reports a missing peer as an immediate close (BridgeClient backoff takes over)', async () => {
    const socket = makePmSocketFactory(HOST)('ignored-url')
    const closes: number[] = []
    socket.onclose = () => closes.push(1)
    await tick()
    expect(closes).toHaveLength(1)
  })
})

// ── the real client over the real socket ────────────────────────────────────
// What the unit tests above can't see: that BridgeClient's handler-assignment
// order, hello envelope, hydrate dispatch and applied ack all survive the trip
// through the postMessage transport. Only the host window is scripted.

const PM_CONFIG: BridgeConfig = {
  token: 'tok',
  wsUrl: '',
  protocol: PROTOCOL_VERSION,
  doc: 'sys',
  file: '',
  version: '',
  transport: 'pm',
  peerOrigin: HOST,
}

const D2 = 'a\nb\na -> b\n'

describe('BridgeClient over the pm socket', () => {
  it('handshake + apply round trip against a scripted host', async () => {
    const host = makeHost()
    const hydrates: { files: FileFrame[]; reconnect: boolean }[] = []
    const applied: FileKind[][] = []
    const statuses: string[] = []
    const client = new BridgeClient({
      config: PM_CONFIG,
      socketFactory: makePmSocketFactory(HOST),
      onHydrate: (files, reconnect) => hydrates.push({ files, reconnect }),
      onFileChanged: () => {},
      onStatus: (s) => statuses.push(s),
      onApplied: (kinds) => applied.push(kinds),
    })
    client.connect()
    // "open" is next-tick, so the hello can't outrun handler assignment.
    expect(host.frames()).toEqual([])
    await tick()
    expect(statuses).toEqual(['connecting', 'connected'])
    expect(host.frames()).toEqual([
      { type: 'hello', protocol: PROTOCOL_VERSION, token: 'tok', doc: 'sys' },
    ])
    expect(host.sent[0]?.origin).toBe(HOST)

    host.post({
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
    host.post({ type: 'hydrate', doc: 'sys', files: [] }, { origin: 'http://evil.test' })
    expect(hydrates).toHaveLength(1)

    expect(client.apply([{ kind: 'd2', content: `${D2}c\n` }]).sent).toEqual(['d2'])
    expect(host.frames().at(-1)).toMatchObject({ type: 'apply', doc: 'sys' })
    host.post({ type: 'applied', doc: 'sys', kinds: ['d2'] })
    expect(applied).toEqual([['d2']])

    client.close()
  })

  it('a vanished host (popup whose opener is gone) lands in the normal reconnect path', async () => {
    // No makeHost(): window.opener is absent.
    const statuses: string[] = []
    const client = new BridgeClient({
      config: PM_CONFIG,
      socketFactory: makePmSocketFactory(HOST),
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
