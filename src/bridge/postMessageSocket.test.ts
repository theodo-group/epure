import { afterEach, describe, expect, it, vi } from 'vitest'

import { PM_ENVELOPE_KEY, makePmSocketFactory, readPmFrame } from './postMessageSocket'

const HOST = 'http://host.test'

type MessageHandler = (ev: MessageEvent) => void

/** Build a socket with a spied listener registration and a fake opener peer. */
const setup = () => {
  const peer = { postMessage: vi.fn() }
  ;(window as unknown as { opener: unknown }).opener = peer
  const addSpy = vi.spyOn(window, 'addEventListener')
  const socket = makePmSocketFactory(HOST)('ignored-url')
  const call = addSpy.mock.calls.find((c) => c[0] === 'message')
  if (!call) throw new Error('socket did not register a message listener')
  return { peer, socket, handler: call[1] as MessageHandler }
}

afterEach(() => {
  vi.restoreAllMocks()
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
    const { peer, socket } = setup()
    socket.send('{"type":"hello"}')
    expect(peer.postMessage).toHaveBeenCalledWith({ [PM_ENVELOPE_KEY]: '{"type":"hello"}' }, HOST)
  })

  it('fires onopen asynchronously, after handlers are assigned', async () => {
    const { socket } = setup()
    const onopen = vi.fn()
    socket.onopen = onopen
    expect(onopen).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    expect(onopen).toHaveBeenCalledTimes(1)
  })

  it('delivers only frames from the pinned origin AND the peer window', () => {
    const { peer, socket, handler } = setup()
    const onmessage = vi.fn()
    socket.onmessage = onmessage
    const ev = (over: object) =>
      ({ origin: HOST, source: peer, data: { [PM_ENVELOPE_KEY]: 'f' }, ...over }) as unknown as MessageEvent
    handler(ev({}))
    expect(onmessage).toHaveBeenCalledWith({ data: 'f' })
    handler(ev({ origin: 'http://evil.test' }))
    handler(ev({ source: {} }))
    handler(ev({ data: { other: 'f' } }))
    expect(onmessage).toHaveBeenCalledTimes(1)
  })

  it('close() detaches: no more inbound, and a pending onopen never fires', async () => {
    const { peer, socket, handler } = setup()
    const onopen = vi.fn()
    const onmessage = vi.fn()
    socket.onopen = onopen
    socket.onmessage = onmessage
    socket.close()
    handler({ origin: HOST, source: peer, data: { [PM_ENVELOPE_KEY]: 'f' } } as unknown as MessageEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(onmessage).not.toHaveBeenCalled()
    expect(onopen).not.toHaveBeenCalled()
  })

  it('reports a missing peer as an immediate close (BridgeClient backoff takes over)', async () => {
    delete (window as unknown as { opener?: unknown }).opener
    const socket = makePmSocketFactory(HOST)('ignored-url')
    const onclose = vi.fn()
    socket.onclose = onclose
    await new Promise((r) => setTimeout(r, 0))
    expect(onclose).toHaveBeenCalledTimes(1)
  })
})
