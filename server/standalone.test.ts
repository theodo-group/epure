import { get } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PROTOCOL_VERSION, type ServerMsg } from './core/protocol'
import { portForPath } from './core/port'
import { startStandalone, type StandaloneHandle } from './standalone'

const INDEX_HTML =
  '<!doctype html><html><head><title>Épure</title></head><body></body></html>'

const fetchText = async (url: string): Promise<{ status: number; body: string }> => {
  const res = await fetch(url)
  return { status: res.status, body: await res.text() }
}

const nextMessage = (socket: WebSocket): Promise<ServerMsg> =>
  new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString()) as ServerMsg))
  })

/** Resolve with the first message of a given type (skips interleaved others). */
const waitForType = <T extends ServerMsg['type']>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerMsg, { type: T }>> =>
  new Promise((resolve) => {
    const onMsg = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg
      if (msg.type === type) {
        socket.off('message', onMsg)
        resolve(msg as Extract<ServerMsg, { type: T }>)
      }
    }
    socket.on('message', onMsg)
  })

const helloed = async (port: number): Promise<WebSocket> => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__epure/ws`)
  await new Promise((r) => socket.once('open', r))
  socket.send(
    JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'secret-token', doc: 'sys' }),
  )
  await waitForType(socket, 'hydrate')
  return socket
}

describe('standalone server', () => {
  let dir: string
  let distDir: string
  let handle: StandaloneHandle

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'epure-srv-'))
    distDir = await mkdtemp(join(tmpdir(), 'epure-dist-'))
    await writeFile(join(distDir, 'index.html'), INDEX_HTML, 'utf8')
    await writeFile(join(dir, 'sys.epr.d2'), 'a\nb\na -> b\n', 'utf8')
    handle = await startStandalone({
      pairInput: join(dir, 'sys.epr.d2'),
      port: 0,
      token: 'secret-token',
      distDir,
      version: '9.9.9',
    })
  })

  afterEach(async () => {
    await handle.close()
    await rm(dir, { recursive: true, force: true })
    await rm(distDir, { recursive: true, force: true })
  })

  it('serves /__epure/config with bridge:true and the version', async () => {
    const { status, body } = await fetchText(`${handle.url}__epure/config`)
    expect(status).toBe(200)
    const cfg = JSON.parse(body)
    expect(cfg).toMatchObject({ bridge: true, version: '9.9.9', doc: 'sys' })
  })

  it('serves /__epure/health with the diagram realpath', async () => {
    const { body } = await fetchText(`${handle.url}__epure/health`)
    expect(JSON.parse(body).realPath).toBe(handle.realPath)
  })

  it('injects the per-session token + retitles the served index.html', async () => {
    const { body } = await fetchText(handle.url)
    expect(body).toContain('window.__EPURE_BRIDGE__')
    expect(body).toContain('secret-token')
    expect(body).toContain('<title>sys — Épure</title>')
  })

  it('round-trips a WS apply: hello → hydrate → apply → applied → disk', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/__epure/ws`)
    await new Promise((r) => socket.once('open', r))

    socket.send(
      JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'secret-token', doc: 'sys' }),
    )
    const hydrate = await nextMessage(socket)
    expect(hydrate.type).toBe('hydrate')

    const layout = '{ "gridSize":40, "nodes":{"a":{"cx":2,"cy":2,"w":4,"h":2}}, "edges":{} }'
    socket.send(JSON.stringify({ type: 'apply', doc: 'sys', files: [{ kind: 'layout', content: layout }] }))
    const applied = await nextMessage(socket)
    expect(applied).toMatchObject({ type: 'applied', kinds: ['layout'] })

    const onDisk = await readFile(join(dir, 'sys.epr.layout.json'), 'utf8')
    expect(onDisk.endsWith('}\n')).toBe(true) // canonical form
    socket.close()
  })

  it('round-trips live feedback: WS submit → GET /poll → POST reply → resolved', async () => {
    const socket = await helloed(handle.port)
    // Register the resolution listener up front so the broadcast can't outrun it.
    const resolved = waitForType(socket, 'feedbackResolved')

    socket.send(
      JSON.stringify({
        type: 'feedback',
        doc: 'sys',
        id: 'fb01',
        text: 'make the api purple',
        target: { kind: 'element', ref: 'a' },
      }),
    )

    // The agent leg: long-poll picks up the queued event.
    const polled = await fetch(`${handle.url}__epure/poll?timeout=3000`)
    expect(await polled.json()).toMatchObject({
      type: 'feedback',
      id: 'fb01',
      text: 'make the api purple',
      target: { kind: 'element', ref: 'a' },
    })

    // Reply; the browser is told over the socket.
    const reply = await fetch(`${handle.url}__epure/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'fb01', status: 'done', message: 'painted' }),
    })
    expect(reply.status).toBe(200)
    expect(await resolved).toMatchObject({ id: 'fb01', status: 'done', message: 'painted' })
    socket.close()
  })

  it('does not lose feedback when the receiving long-poll is aborted', async () => {
    const socket = await helloed(handle.port)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    // Park a poll with nothing queued, then abort it WHILE parked.
    const aborter = get(
      { host: '127.0.0.1', port: handle.port, path: '/__epure/poll?timeout=5000' },
      () => {},
    )
    aborter.on('error', () => {})
    await sleep(200) // let it park on the server
    aborter.destroy() // client dies before any event is delivered
    await sleep(150) // let the server observe the abort

    // Submit: it gets delivered to the dead waiter, which ungets it.
    socket.send(
      JSON.stringify({ type: 'feedback', doc: 'sys', id: 'fb02', text: 'hi', target: { kind: 'none' } }),
    )
    await sleep(150)

    // A fresh poll must still receive it — at-most-once, not zero-once.
    const polled = await fetch(`${handle.url}__epure/poll?timeout=3000`)
    expect(await polled.json()).toMatchObject({ type: 'feedback', id: 'fb02', text: 'hi' })
    socket.close()
  })

  it('rejects /__epure/poll requests carrying a browser Origin header', async () => {
    const res = await fetch(`${handle.url}__epure/poll?timeout=100`, {
      headers: { origin: handle.url.replace(/\/$/, '') },
    })
    expect(res.status).toBe(403)
  })

  it('rejects a WS hello with the wrong token', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/__epure/ws`)
    await new Promise((r) => socket.once('open', r))
    socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'wrong', doc: 'sys' }))
    const reply = await nextMessage(socket)
    expect(reply).toMatchObject({ type: 'rejected', reason: 'unauthorized' })
    socket.close()
  })

  it('the deterministic port is stable and the second bind on it conflicts', async () => {
    const port = portForPath(handle.realPath)
    expect(port).toBe(portForPath(handle.realPath))
    // Bind the deterministic port, then a second bind must fail — this EADDRINUSE
    // is exactly the signal the CLI uses to reuse-or-fallback (the port IS the lock).
    const first = await startStandalone({
      pairInput: join(dir, 'sys.epr.d2'),
      port,
      token: 't',
      distDir,
      version: '1',
    })
    await expect(
      startStandalone({ pairInput: join(dir, 'sys.epr.d2'), port, token: 't', distDir, version: '1' }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await first.close()
  })
})
