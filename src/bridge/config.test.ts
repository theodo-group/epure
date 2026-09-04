import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectBridge, readBridgeSignal, readHashBridge, readInjectedBridge, wsEndpoint } from './config'

const setGlobal = (value: unknown) => {
  ;(window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__ = value
}

const VALID = { token: 'tok', wsUrl: '/__epure/ws', protocol: 1, doc: 'sys', file: '/x', version: '1' }

afterEach(() => {
  delete (window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__
  delete (window as unknown as { opener?: unknown }).opener
  window.location.hash = ''
  vi.unstubAllGlobals()
})

const PM_HASH = '#bridge=pm&origin=http%3A%2F%2Fhost.test&token=tok&doc=archi'

describe('readInjectedBridge', () => {
  it('returns null with no global', () => {
    expect(readInjectedBridge()).toBeNull()
  })

  it('parses a well-formed global', () => {
    setGlobal(VALID)
    expect(readInjectedBridge()).toMatchObject({ token: 'tok', doc: 'sys' })
  })

  it('rejects a global with no token', () => {
    setGlobal({ ...VALID, token: '' })
    expect(readInjectedBridge()).toBeNull()
  })
})

describe('detectBridge', () => {
  it('returns null when there is no injected global (the Pages case)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(await detectBridge()).toBeNull()
  })

  it('returns the config when the injected global is present', async () => {
    setGlobal(VALID)
    expect(await detectBridge()).toMatchObject({ token: 'tok' })
  })

  it('trusts the injected global as authoritative (no endpoint veto)', async () => {
    // The global is same-origin and server-injected; detection must agree with
    // App.tsx's synchronous bootstrap, which keys off the same global. A config
    // endpoint must never be able to flip a present global to null.
    setGlobal(VALID)
    expect(await detectBridge()).toMatchObject({ token: 'tok' })
  })
})

describe('readHashBridge', () => {
  it('returns null without the hash', () => {
    expect(readHashBridge()).toBeNull()
  })

  it('parses the pm hash when a host window exists', () => {
    ;(window as unknown as { opener: unknown }).opener = {}
    window.location.hash = PM_HASH
    expect(readHashBridge()).toMatchObject({
      token: 'tok',
      doc: 'archi',
      transport: 'pm',
      peerOrigin: 'http://host.test',
    })
  })

  it('ignores a pm hash with no opener and no embedding parent (stale bookmark)', () => {
    window.location.hash = PM_HASH
    expect(readHashBridge()).toBeNull()
  })

  it('requires a token and an http(s) origin', () => {
    ;(window as unknown as { opener: unknown }).opener = {}
    window.location.hash = '#bridge=pm&origin=http%3A%2F%2Fhost.test&token='
    expect(readHashBridge()).toBeNull()
    window.location.hash = '#bridge=pm&origin=javascript%3Aalert(1)&token=tok'
    expect(readHashBridge()).toBeNull()
  })
})

describe('readBridgeSignal', () => {
  it('prefers the injected global over the hash (disk server is authoritative)', () => {
    setGlobal(VALID)
    ;(window as unknown as { opener: unknown }).opener = {}
    window.location.hash = PM_HASH
    expect(readBridgeSignal()).toMatchObject({ wsUrl: '/__epure/ws' })
  })

  it('falls back to the hash, then to null (standalone)', async () => {
    ;(window as unknown as { opener: unknown }).opener = {}
    window.location.hash = PM_HASH
    expect(readBridgeSignal()).toMatchObject({ transport: 'pm' })
    expect(await detectBridge()).toMatchObject({ transport: 'pm' })
    window.location.hash = ''
    expect(readBridgeSignal()).toBeNull()
  })
})

describe('wsEndpoint', () => {
  it('builds an absolute ws URL from the page origin', () => {
    expect(wsEndpoint(VALID)).toMatch(/^wss?:\/\/[^/]+\/__epure\/ws$/)
  })
})
