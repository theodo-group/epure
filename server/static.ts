// Serve the built SPA's files (`dist/`) for the standalone host. The tree is
// fixed and small in variety — html, js, css, wasm, svg and png — so this is a
// plain file server: GET/HEAD only, a weak ETag (size + mtime) with 304s, and
// nothing outside the root is ever reachable, however the path is encoded.
// Anything it doesn't serve goes to `next` (the SPA fallback / 404).

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export type StaticHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => Promise<void>

export const serveStatic = (root: string): StaticHandler => {
  const base = resolve(root)
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let path: string
    try {
      path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    } catch {
      return next() // malformed escape: not a file we have
    }
    const file = resolve(base, `.${path}`)
    if (!file.startsWith(base + sep)) return next()
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return next()

    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`
    res.setHeader('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304
      res.end()
      return
    }
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Content-Length', info.size)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
  }
}
