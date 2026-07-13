// Standalone host: a plain Node http server that serves the built SPA (`dist/`)
// via sirv and carries the bridge WebSocket. This is what `npx epure` runs.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import sirv from 'sirv'

import { BridgeCore } from './core/bridge'
import { resolvePair } from './core/pair'
import { configBody, injectBridge, type BridgeRuntime } from './inject'
import { attachBridgeWs, isLocalRequest } from './ws'

export interface StandaloneOptions {
  /** User-supplied path to any sidecar or the bare stem. */
  pairInput: string
  /** Port to bind; 0 lets the OS assign one. Bound on 127.0.0.1 only. */
  port: number
  /** Per-session token required on the WS hello. */
  token: string
  /** Directory holding the built SPA (index.html + assets). */
  distDir: string
  version: string
}

export interface StandaloneHandle {
  url: string
  port: number
  /** realpath of the `.epr.d2` (used for the deterministic-port identity). */
  realPath: string
  close(): Promise<void>
}

export const startStandalone = async (
  opts: StandaloneOptions,
): Promise<StandaloneHandle> => {
  const pair = resolvePair(opts.pairInput)
  const realPath = await realpath(pair.paths.d2).catch(() => pair.paths.d2)

  const runtime: BridgeRuntime = {
    doc: pair.stem,
    file: realPath,
    token: opts.token,
    version: opts.version,
  }

  const serveStatic = sirv(opts.distDir, { dev: false, etag: true, single: false })

  const serveIndex = async (res: ServerResponse): Promise<void> => {
    try {
      const raw = await readFile(join(opts.distDir, 'index.html'), 'utf8')
      const titled = raw.replace(
        /<title>.*?<\/title>/,
        `<title>${pair.stem} — Épure</title>`,
      )
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(injectBridge(titled, runtime))
    } catch {
      res.statusCode = 500
      res.end('epure: built SPA not found — run `pnpm build` first')
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'

    if (path === '/__epure/health' || path === '/__epure/config') {
      if (!isLocalRequest(req)) {
        res.statusCode = 403
        res.end()
        return
      }
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(path === '/__epure/health' ? JSON.stringify({ realPath }) : configBody(runtime))
      return
    }

    if (path === '/' || path === '/index.html') {
      void serveIndex(res)
      return
    }

    serveStatic(req, res, () => {
      // SPA fallback: unknown non-asset routes get index.html.
      if (req.method === 'GET' && !path.includes('.')) {
        void serveIndex(res)
      } else {
        res.statusCode = 404
        res.end()
      }
    })
  }

  const server = createServer(handler)

  // Wire the bridge. The core's outbound notifications ARE the ws broadcast, so
  // create the ws layer first and hand its broadcast to the core.
  let core: BridgeCore
  const ws = attachBridgeWs(
    server,
    {
      doc: () => core.doc,
      hydrate: () => core.hydrate(),
      apply: (files) => core.applyInbound(files),
    },
    opts.token,
  )
  core = new BridgeCore({
    pair,
    onFileChanged: ws.broadcast,
    // The rendered PNG trails the text pair on every edit; icons + routing wasm
    // both live in the built SPA (vite copies `public/` to the dist root).
    png: {
      iconsDir: join(opts.distDir, 'icons'),
      wasmPath: join(opts.distDir, 'libavoid.wasm'),
    },
  })
  await core.start()

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : opts.port)
    })
  })

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    realPath,
    async close() {
      await ws.close()
      await core.stop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
