// Standalone host: a plain Node http server that serves the built SPA (`dist/`)
// via sirv and carries the bridge WebSocket. This is what `npx epure` runs.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import sirv from 'sirv'

import { BridgeCore } from './core/bridge'
import { createFeedbackHub, type FeedbackHub } from './core/feedback'
import { resolvePair } from './core/pair'
import type { FeedbackMsg } from './core/protocol'
import { configBody, injectBridge, type BridgeRuntime } from './inject'
import { attachBridgeWs, isLocalRequest } from './ws'

/** Server-held long-poll slice. The CLI re-polls on `timeout`, so this only has
 *  to stay under any socket idle ceiling — 25s is comfortable. */
const MAX_POLL_SLICE_MS = 25_000
/** A feedback reply body is `{id,status,message?}` — tiny; cap to refuse abuse. */
const MAX_REPLY_BYTES = 1024

const feedbackEventFromMsg = (msg: FeedbackMsg) => ({
  type: 'feedback' as const,
  id: msg.id,
  doc: msg.doc,
  text: msg.text,
  target: msg.target,
  createdAt: new Date().toISOString(),
})

const readBody = (req: IncomingMessage, cap: number): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > cap) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

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

    // The agent leg of live feedback. Tokenless (the CLI can't get one without
    // a discovery file, which Épure forbids) but locked to non-browser local
    // clients: localhost Host AND no Origin header. A browser fetch always sends
    // Origin, so this can only be the `epure poll` CLI.
    if (path === '/__epure/poll') {
      if (!isLocalRequest(req) || req.headers.origin !== undefined) {
        res.statusCode = 403
        res.end()
        return
      }
      if (req.method === 'GET') {
        void handlePoll(req, res)
        return
      }
      if (req.method === 'POST') {
        void handleReply(req, res)
        return
      }
      res.statusCode = 405
      res.end()
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

  // GET /__epure/poll — long-poll for the next feedback event. Holds the
  // request up to a bounded slice; the CLI re-polls on `timeout`.
  const handlePoll = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const requested = Number(new URL(req.url ?? '', 'http://x').searchParams.get('timeout'))
    const slice = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_POLL_SLICE_MS)
      : MAX_POLL_SLICE_MS
    // The agent's one-shot poll is killed and re-run constantly; if it dies while
    // we're parked, the response would be written to a dead socket and the event
    // lost (and its id leaked in `inflight`). Track the abort and put the event
    // back so the next poll gets it.
    let aborted = false
    req.on('close', () => {
      aborted = true
    })
    const response = await hub.poll(slice)
    if (aborted) {
      if (response.type === 'feedback') hub.unget(response)
      return
    }
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(response))
  }

  // POST /__epure/poll — the agent's verdict on an event.
  const handleReply = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    let parsed: { id?: unknown; status?: unknown; message?: unknown }
    try {
      parsed = JSON.parse(await readBody(req, MAX_REPLY_BYTES))
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'invalid reply body' }))
      return
    }
    if (typeof parsed.id !== 'string' || (parsed.status !== 'done' && parsed.status !== 'error')) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'reply needs {id, status: done|error}' }))
      return
    }
    hub.reply({
      id: parsed.id,
      status: parsed.status,
      ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  }

  const server = createServer(handler)

  // Wire the bridge. The core's outbound notifications ARE the ws broadcast, so
  // create the ws layer first and hand its broadcast to the core and the hub.
  let core: BridgeCore
  let hub: FeedbackHub
  const ws = attachBridgeWs(
    server,
    {
      doc: () => core.doc,
      hydrate: () => core.hydrate(),
      apply: (files) => core.applyInbound(files),
      feedback: (msg) => hub.submit(feedbackEventFromMsg(msg)),
      onReadyChanged: (count) => hub.onBrowsersChanged(count),
    },
    opts.token,
  )
  hub = createFeedbackHub(ws.broadcast)
  core = new BridgeCore({ pair, onFileChanged: ws.broadcast })
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
      hub.stop()
      await ws.close()
      await core.stop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
