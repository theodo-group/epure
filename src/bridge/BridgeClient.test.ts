import { describe, expect, it, beforeEach } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'

import { BridgeClient, type SocketLike } from './BridgeClient'
import type { BridgeConfig } from './config'
import type { ServerMsg } from './protocol'

const CONFIG: BridgeConfig = {
  token: 'tok',
  wsUrl: '/__epure/ws',
  protocol: 1,
  doc: 'sys',
  file: '/x/sys.epr.d2',
  version: '1',
}

const D2 = 'a\nb\na -> b\n'
const LAYOUT_CANON = canonicalizeLayout({
  gridSize: 40,
  nodes: { a: { cx: 2, cy: 2, w: 4, h: 2 } },
  edges: {},
})

class FakeSocket implements SocketLike {
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  closed = false
  send(d: string) {
    this.sent.push(d)
  }
  close() {
    this.closed = true
  }
  // test drivers
  open() {
    this.onopen?.()
  }
  emit(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  drop() {
    this.onclose?.()
  }
  lastSent() {
    return this.sent.length ? JSON.parse(this.sent[this.sent.length - 1]!) : null
  }
}

const tick = () => new Promise((r) => setTimeout(r, 1))

const makeClient = (overrides: Partial<Parameters<typeof harness>[0]> = {}) =>
  harness({
    onHydrate: () => {},
    onFileChanged: () => {},
    onStatus: () => {},
    ...overrides,
  })

function harness(cb: {
  onHydrate?: (files: unknown[], reconnect: boolean) => void
  onFileChanged?: (kind: string, content: string | null, valid: boolean, error?: string) => void
  onStatus?: (s: string) => void
  onApplied?: (kinds: string[]) => void
  onRejected?: (reason: string, error?: string) => void
}) {
  const sockets: FakeSocket[] = []
  const client = new BridgeClient({
    config: CONFIG,
    backoffMs: [0],
    socketFactory: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    onHydrate: cb.onHydrate as never,
    onFileChanged: cb.onFileChanged as never,
    onStatus: cb.onStatus as never,
    onApplied: cb.onApplied,
    onRejected: cb.onRejected,
  })
  return { client, sockets, last: () => sockets[sockets.length - 1]! }
}

describe('BridgeClient handshake + dispatch', () => {
  it('sends hello with token + protocol on open', () => {
    const statuses: string[] = []
    const { client, last } = makeClient({ onStatus: (s) => statuses.push(s) })
    client.connect()
    last().open()
    expect(last().lastSent()).toMatchObject({ type: 'hello', token: 'tok', protocol: 1, doc: 'sys' })
    expect(statuses).toContain('connecting')
    expect(statuses).toContain('connected')
  })

  it('emits hydrate with reconnect=false first, true after a reconnect', () => {
    const flags: boolean[] = []
    const { client, last } = makeClient({ onHydrate: (_f, r) => flags.push(r) })
    client.connect()
    last().open()
    last().emit({ type: 'hydrate', doc: 'sys', files: [] })
    last().drop()
    return tick().then(() => {
      last().open()
      last().emit({ type: 'hydrate', doc: 'sys', files: [] })
      expect(flags).toEqual([false, true])
    })
  })

  it('forwards fileChanged to the callback', () => {
    const seen: { kind: string; content: string | null }[] = []
    const { client, last } = makeClient({
      onFileChanged: (kind, content) => seen.push({ kind, content }),
    })
    client.connect()
    last().open()
    last().emit({ type: 'fileChanged', doc: 'sys', kind: 'd2', content: D2, valid: true })
    expect(seen).toEqual([{ kind: 'd2', content: D2 }])
  })
})

describe('BridgeClient.apply — validity gate + echo suppression', () => {
  it('drops invalid content, reports it, never sends it', () => {
    const { client, last } = makeClient()
    client.connect()
    last().open()
    last().sent.length = 0
    const { sent, invalid } = client.apply([{ kind: 'd2', content: 'a -> ' /* dangling */ }])
    // (an unterminated edge is a parse error)
    expect(invalid).toContain('d2')
    expect(sent).toEqual([])
    expect(last().sent).toHaveLength(0)
  })

  it('sends a real change, then suppresses the identical re-send (no-op)', () => {
    const { client, last } = makeClient()
    client.connect()
    last().open()
    last().sent.length = 0
    const first = client.apply([{ kind: 'd2', content: D2 }])
    expect(first.sent).toEqual(['d2'])
    expect(last().sent).toHaveLength(1)
    const second = client.apply([{ kind: 'd2', content: D2 }])
    expect(second.sent).toEqual([])
    expect(last().sent).toHaveLength(1) // unchanged
  })

  it('suppresses the outbound echo of a remote change (re-entrancy guard)', () => {
    const { client, last } = makeClient()
    client.connect()
    last().open()
    // Remote layout arrives → client records its key.
    last().emit({ type: 'fileChanged', doc: 'sys', kind: 'layout', content: LAYOUT_CANON, valid: true })
    last().sent.length = 0
    // The store would now hold that layout; the outbound must NOT bounce it back.
    const result = client.apply([{ kind: 'layout', content: LAYOUT_CANON }])
    expect(result.sent).toEqual([])
    expect(last().sent).toHaveLength(0)
  })

  it('treats reformatted-but-equivalent layout as an echo (canonical key)', () => {
    const { client, last } = makeClient()
    client.connect()
    last().open()
    last().emit({ type: 'fileChanged', doc: 'sys', kind: 'layout', content: LAYOUT_CANON, valid: true })
    last().sent.length = 0
    const messy = '{ "gridSize":40, "nodes":{ "a":{"cy":2,"cx":2,"h":2,"w":4} }, "edges":{} }'
    expect(client.apply([{ kind: 'layout', content: messy }]).sent).toEqual([])
  })

  it('markRemote prevents writing a synthesized default straight back to disk', () => {
    const { client, last } = makeClient()
    client.connect()
    last().open()
    const def = canonicalizeLayout({ gridSize: 40, nodes: {}, edges: {} })
    client.markRemote('layout', def)
    last().sent.length = 0
    expect(client.apply([{ kind: 'layout', content: def }]).sent).toEqual([])
  })
})

describe('BridgeClient reconnect', () => {
  it('reconnects after an unexpected drop and re-sends hello', async () => {
    const statuses: string[] = []
    const { client, sockets, last } = makeClient({ onStatus: (s) => statuses.push(s) })
    client.connect()
    last().open()
    expect(sockets).toHaveLength(1)
    last().drop()
    expect(statuses).toContain('disconnected')
    await tick()
    expect(sockets).toHaveLength(2)
    last().open()
    expect(last().lastSent()).toMatchObject({ type: 'hello' })
  })

  it('stops reconnecting after an unauthorized rejection', async () => {
    const { client, sockets, last } = makeClient()
    client.connect()
    last().open()
    last().emit({ type: 'rejected', doc: 'sys', reason: 'unauthorized' })
    last().drop()
    await tick()
    expect(sockets).toHaveLength(1) // no reconnect attempt
  })

  it('does not reconnect after an intentional close()', async () => {
    const { client, sockets, last } = makeClient()
    client.connect()
    last().open()
    client.close()
    await tick()
    expect(sockets).toHaveLength(1)
  })
})

beforeEach(() => {
  // each test builds its own client; nothing global to reset
})
