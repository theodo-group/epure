import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectBridge, readInjectedBridge, wsEndpoint } from './config'

const setGlobal = (value: unknown) => {
  ;(window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__ = value
}

const VALID = { token: 'tok', wsUrl: '/__epure/ws', protocol: 1, doc: 'sys', file: '/x', version: '1' }

afterEach(() => {
  delete (window as unknown as { __EPURE_BRIDGE__?: unknown }).__EPURE_BRIDGE__
  vi.unstubAllGlobals()
})

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

describe('wsEndpoint', () => {
  it('builds an absolute ws URL from the page origin', () => {
    expect(wsEndpoint(VALID)).toMatch(/^wss?:\/\/[^/]+\/__epure\/ws$/)
  })
})
