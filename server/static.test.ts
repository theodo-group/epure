import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { serveStatic } from './static'

let parent: string
let server: Server
let base: string

beforeAll(async () => {
  // dist/ sits next to a secret file, and next to a sibling directory sharing
  // its name as a prefix (dist-secret/): neither must ever be reachable.
  parent = await mkdtemp(join(tmpdir(), 'epure-static-'))
  const dist = join(parent, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await mkdir(join(dist, 'icons'), { recursive: true })
  await mkdir(join(parent, 'dist-secret'), { recursive: true })
  await writeFile(join(parent, 'secret.txt'), 'nope')
  await writeFile(join(parent, 'dist-secret', 'key.txt'), 'nope')
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(dist, 'libavoid.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]))
  await writeFile(join(dist, 'icons', 'a b.svg'), '<svg/>')
  const handler = serveStatic(dist)
  server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 418 // "next": the host's fallback
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await rm(parent, { recursive: true, force: true })
})

// Raw paths: fetch() would normalise `..` away before sending.
const get = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
    body: string
  }>((resolve, reject) => {
    const req = request(
      `${base}${path}`,
      { method: init.method ?? 'GET', headers: init.headers, path },
      (res: IncomingMessage) => {
        let body = ''
        res.on('data', (c) => {
          body += c
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })

describe('serveStatic', () => {
  it('serves files with their content type and length', async () => {
    const js = await get('/assets/app.js')
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toBe('text/javascript')
    expect(js.headers['content-length']).toBe('14')
    expect(js.body).toBe('console.log(1)')
    expect((await get('/libavoid.wasm')).headers['content-type']).toBe('application/wasm')
    expect((await get('/icons/a%20b.svg?v=1')).headers['content-type']).toBe('image/svg+xml')
  })

  it('answers a matching If-None-Match with 304', async () => {
    const first = await get('/assets/app.js')
    const etag = first.headers.etag as string
    expect(etag).toMatch(/^W\/"/)
    const again = await get('/assets/app.js', { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
    expect(again.body).toBe('')
  })

  it('changes the ETag when the size changes, even within the same mtime', async () => {
    // A rebuild can rewrite a file within the mtime's resolution (or restore its
    // mtime): the size must still tell the two contents apart.
    const file = join(parent, 'dist', 'assets', 'swap.js')
    const pinned = new Date('2026-01-01T00:00:00Z')
    await writeFile(file, 'a')
    await utimes(file, pinned, pinned)
    const first = (await get('/assets/swap.js')).headers.etag as string
    await writeFile(file, 'abc')
    await utimes(file, pinned, pinned)
    const second = await get('/assets/swap.js', { headers: { 'if-none-match': first } })
    expect(second.status).toBe(200)
    expect(second.body).toBe('abc')
    expect(second.headers.etag).not.toBe(first)
  })

  it('answers HEAD without a body, and leaves other methods to the host', async () => {
    const head = await get('/assets/app.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe('14')
    expect(head.body).toBe('')
    expect((await get('/assets/app.js', { method: 'POST' })).status).toBe(418)
  })

  it('never serves outside the root, however the path is encoded', async () => {
    for (const path of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      // Resolves to <parent>/dist-secret/key.txt, which merely starts with the root's path.
      '/../dist-secret/key.txt',
      '/%2e%2e/dist-secret/key.txt',
    ]) {
      const res = await get(path)
      expect(res.body, path).not.toBe('nope')
      expect(res.status, path).toBe(418)
    }
  })

  it('leaves directories, missing files and malformed paths to the host', async () => {
    expect((await get('/icons/')).status).toBe(418)
    expect((await get('/assets/missing.js')).status).toBe(418)
    expect((await get('/%E0%A4%A')).status).toBe(418)
  })
})
