// Shared helpers for handing the SPA its bridge context. Both hosts:
//   - inject a `<script>` into the served index.html exposing the per-session
//     token + ws path + filename (read synchronously at boot — no round-trip),
//   - answer `GET /__epure/config` so the same bundle that ships to GitHub
//     Pages can detect "am I running under a bridge?" purely at runtime.

import { PROTOCOL_VERSION } from './core/protocol'
import { WS_PATH } from './ws'

export interface BridgeRuntime {
  /** Diagram stem, e.g. `system`. */
  doc: string
  /** Absolute realpath of the `.epr.d2` — shown in health/config. */
  file: string
  /** Per-session token required on the WS `hello`. */
  token: string
  /** Package version string. */
  version: string
}

/** Body for `GET /__epure/config`. `bridge:true` is the detection signal;
 *  404 / HTML means "no bridge" (the Pages case). The token is NOT here — it is
 *  injected into index.html so it is same-origin-readable but not served as an
 *  independent fetchable endpoint. */
export const configBody = (rt: BridgeRuntime): string =>
  JSON.stringify({
    bridge: true,
    version: rt.version,
    protocol: PROTOCOL_VERSION,
    wsUrl: WS_PATH,
    doc: rt.doc,
    file: rt.file,
  })

// Keep the JSON safe to embed inside a <script>: neutralise the `<` that could
// start `</script>`, and the two Unicode line terminators that are legal in
// JSON but terminate a script's source text.
const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)
const escapeForScript = (s: string): string =>
  s
    .split('<').join('\\u003c')
    .split(LINE_SEP).join('\\u2028')
    .split(PARA_SEP).join('\\u2029')

/** Inject the bridge global before `</head>`. Falls back to prepending if no
 *  head close tag is present (defensive — the real index.html always has one). */
export const injectBridge = (html: string, rt: BridgeRuntime): string => {
  const payload = {
    token: rt.token,
    wsUrl: WS_PATH,
    protocol: PROTOCOL_VERSION,
    doc: rt.doc,
    file: rt.file,
    version: rt.version,
  }
  const tag = `<script>window.__EPURE_BRIDGE__=${escapeForScript(
    JSON.stringify(payload),
  )}</script>`
  return html.includes('</head>')
    ? html.replace('</head>', `${tag}</head>`)
    : tag + html
}
