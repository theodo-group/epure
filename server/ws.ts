// Bridge WebSocket layer, shared by both hosts. Uses `ws` in `noServer` mode
// and handles the HTTP `upgrade` itself on a dedicated path, so it coexists
// with Vite's own HMR socket during `pnpm dev`.
//
// Security (all defence-in-depth for a localhost-only tool):
//   - the host binds 127.0.0.1, so the socket is never on the network,
//   - Origin/Host are checked on upgrade to defeat DNS-rebinding,
//   - a per-session token (injected into the served index.html) is required on
//     `hello` before any file content flows.

import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocket, WebSocketServer } from 'ws'

import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type FileFrame,
  type FileKind,
  type ServerMsg,
} from './core/protocol'

export const WS_PATH = '/__epure/ws'

/** What the WS layer needs from the bridge core, injected to avoid an init
 *  cycle (the core's `onFileChanged` is this layer's `broadcast`). */
export interface BridgeHandlers {
  doc(): string
  hydrate(): Promise<FileFrame[]>
  apply(files: { kind: FileKind; content: string }[]): Promise<FileKind[]>
}

export interface BridgeWs {
  broadcast(msg: ServerMsg): void
  close(): Promise<void>
}

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** True when the request's Host and (optional) Origin are localhost — the
 *  Origin/Host guard that, with the 127.0.0.1 bind, defeats DNS-rebinding.
 *  Shared by the WS upgrade and the `/__epure/*` HTTP endpoints. */
export const isLocalRequest = (req: IncomingMessage): boolean => {
  const host = req.headers.host ?? ''
  const hostname = host.replace(/:\d+$/, '')
  if (!LOCAL_HOSTNAMES.has(hostname)) return false
  // A browser sends Origin; non-browser clients (tests, curl) may omit it.
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

const send = (socket: WebSocket, msg: ServerMsg): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

export const attachBridgeWs = (
  httpServer: HttpServer,
  handlers: BridgeHandlers,
  token: string,
): BridgeWs => {
  const wss = new WebSocketServer({ noServer: true })
  /** Sockets that completed a valid `hello`. */
  const ready = new Set<WebSocket>()

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== WS_PATH) return // not ours — leave it for Vite HMR etc.
    if (!isLocalRequest(req)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req)
    })
  }
  httpServer.on('upgrade', onUpgrade)

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      void handleMessage(socket, raw.toString())
    })
    socket.on('close', () => {
      ready.delete(socket)
    })
  })

  const handleMessage = async (socket: WebSocket, raw: string): Promise<void> => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return
    }

    if (msg.type === 'hello') {
      if (msg.protocol !== PROTOCOL_VERSION || msg.token !== token) {
        send(socket, {
          type: 'rejected',
          doc: handlers.doc(),
          reason: 'unauthorized',
        })
        socket.close()
        return
      }
      ready.add(socket)
      send(socket, {
        type: 'hydrate',
        doc: handlers.doc(),
        files: await handlers.hydrate(),
      })
      return
    }

    // Every other message requires a completed hello.
    if (!ready.has(socket)) {
      send(socket, { type: 'rejected', doc: handlers.doc(), reason: 'unauthorized' })
      return
    }

    if (msg.type === 'apply') {
      try {
        const kinds = await handlers.apply(msg.files)
        send(socket, { type: 'applied', doc: handlers.doc(), kinds })
      } catch (e) {
        send(socket, {
          type: 'rejected',
          doc: handlers.doc(),
          reason: 'invalid',
          error: (e as Error).message,
        })
      }
    }
  }

  return {
    broadcast(msg) {
      for (const socket of ready) send(socket, msg)
    },
    async close() {
      httpServer.off('upgrade', onUpgrade)
      for (const socket of wss.clients) socket.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
