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
