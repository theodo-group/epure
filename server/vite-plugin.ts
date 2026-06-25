// Vite plugin host: the bridge for `pnpm dev` while developing Épure itself.
// Enabled only when `EPURE_FILE` points at a diagram; otherwise it is inert and
// `pnpm dev` behaves exactly as before (localStorage mode).
//
// It reuses Vite's own http server for the WebSocket upgrade (the ws layer is
// `noServer` and filters on a dedicated path, so it coexists with HMR), and
// injects the bridge global via `transformIndexHtml`.

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { Server as HttpServer } from 'node:http'

import type { Plugin } from 'vite'

// Type-only: erased at compile, so the Vite *config loader* (plain Node, no `@`
// alias) never follows this into `src/`. The value is loaded at dev time via
// `server.ssrLoadModule`, which DOES resolve the alias.
import type { BridgeCore } from './core/bridge'
import { resolvePair } from './core/pair'
import { configBody, injectBridge, type BridgeRuntime } from './inject'
import { attachBridgeWs, isLocalRequest } from './ws'

export const epureBridge = (): Plugin => {
  const file = process.env.EPURE_FILE
  if (!file) {
    return { name: 'epure-bridge', apply: 'serve' }
  }

  const pair = resolvePair(file)
  const realPath = (() => {
    try {
      return realpathSync(pair.paths.d2)
    } catch {
      return pair.paths.d2
    }
  })()
  const token = randomUUID()
  const runtime: BridgeRuntime = {
    doc: pair.stem,
    file: realPath,
    token,
    version: '0.0.0-dev',
  }

  let core: BridgeCore | null = null

  return {
    name: 'epure-bridge',
    apply: 'serve',

    transformIndexHtml(html) {
      return injectBridge(html, runtime)
    },

    async configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (path !== '/__epure/config' && path !== '/__epure/health') return next()
        if (!isLocalRequest(req)) {
          res.statusCode = 403
          res.end()
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(path === '/__epure/health' ? JSON.stringify({ realPath }) : configBody(runtime))
      })

      // Vite may run on http or http2; the bridge only uses `on/off('upgrade')`,
      // present on both — narrow to the node http Server shape.
      const httpServer = server.httpServer as HttpServer | null
      if (!httpServer) return

      const ws = attachBridgeWs(
        httpServer,
        {
          doc: () => pair.stem,
          hydrate: () => core!.hydrate(),
          apply: (files) => core!.applyInbound(files),
        },
        token,
      )
      // Load bridge-core through Vite so its `@/`-aliased src imports resolve.
      const { BridgeCore: BridgeCoreImpl } = (await server.ssrLoadModule(
        '/server/core/bridge.ts',
      )) as typeof import('./core/bridge')
      core = new BridgeCoreImpl({ pair, onFileChanged: ws.broadcast })
      void core.start()
      server.config.logger.info(`  ➜  Épure bridge: ${pair.stem} (${realPath})`)

      const dispose = async () => {
        await ws.close()
        await core?.stop()
      }
      server.httpServer?.once('close', () => void dispose())
    },
  }
}

export default epureBridge
