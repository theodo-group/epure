import { afterEach, describe, expect, it } from 'vitest'

import { bridge, bridgeUrl, wsEndpoint } from './config'
import { PROTOCOL_VERSION } from './protocol'

const INJECTED = {
  token: 'tok',
  wsUrl: '/__epure/ws',
  protocol: PROTOCOL_VERSION,
  doc: 'sys',
  file: '/x',
  version: '1',
}

afterEach(() => {
  delete window.__EPURE_BRIDGE__
  window.opener = null
  window.location.hash = ''
})

/** Boot the page the way a host does: opened by a window, on a bridgeUrl. */
const embed = () => {
  window.opener = {}
  const url = bridgeUrl('https://app.test/', {
    origin: 'http://host.test',
    token: 'tok',
    doc: 'archi',
  })
  window.location.hash = new URL(url).hash
}

describe('bridge', () => {
  it('returns null on the bare Pages bundle (no global, no hash): standalone', () => {
    expect(bridge()).toBeNull()
  })

  it('reads a disk-server host from the injected global, stamped ws', () => {
    window.__EPURE_BRIDGE__ = INJECTED
    expect(bridge()).toEqual({ transport: 'ws', ...INJECTED })
  })

  it('rejects an injected global with no token', () => {
    window.__EPURE_BRIDGE__ = { ...INJECTED, token: '' }
    expect(bridge()).toBeNull()
  })

  it('reads an embedding host back from its own bridgeUrl', () => {
    embed()
    expect(bridge()).toEqual({
      transport: 'pm',
      token: 'tok',
      protocol: PROTOCOL_VERSION,
      doc: 'archi',
      origin: 'http://host.test',
    })
  })

  it('ignores a pm hash with no opener and no embedding parent (stale bookmark)', () => {
    embed()
    window.opener = null
    expect(bridge()).toBeNull()
  })

  it('requires a token and an http(s) origin in the hash', () => {
    window.opener = {}
    window.location.hash = '#bridge=pm&origin=http%3A%2F%2Fhost.test&token='
    expect(bridge()).toBeNull()
    window.location.hash = '#bridge=pm&origin=javascript%3Aalert(1)&token=tok'
    expect(bridge()).toBeNull()
  })

  it('prefers the injected global over the hash (disk server is authoritative)', () => {
    window.__EPURE_BRIDGE__ = INJECTED
    embed()
    expect(bridge()).toMatchObject({ transport: 'ws' })
  })
})

describe('wsEndpoint', () => {
  it('builds an absolute ws URL from the page origin', () => {
    expect(wsEndpoint({ transport: 'ws', ...INJECTED })).toMatch(/^wss?:\/\/[^/]+\/__epure\/ws$/)
  })
})
