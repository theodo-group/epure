// `@theodo-group/epure/bridge`: the host-side surface of the live bridge.
//
// A page that embeds the editor (iframe or popup) plays the server role of the
// wire protocol (src/bridge/protocol.ts) over `window.postMessage`:
//
//   iframe.src = bridgeUrl(app, { origin: location.origin, token, doc })
//   const msg = unwrap(event.data)        // null when not bridge traffic
//   frame.postMessage(wrap(reply), appOrigin)
//
// Answer `hello` with `hydrate`, receive `apply`, ack with `applied`. Types,
// constants and tiny pure functions only; no DOM touched at import time, safe
// in Node and the browser alike.

export {
  PROTOCOL_VERSION,
  FILE_KINDS,
  type FileKind,
  type FileFrame,
  type HelloMsg,
  type ApplyMsg,
  type ClientMsg,
  type HydrateMsg,
  type FileChangedMsg,
  type AppliedMsg,
  type RejectedMsg,
  type ServerMsg,
  type BridgeMsg,
} from '../src/bridge/protocol'
export { wrap, unwrap } from '../src/bridge/channel'
export { bridgeUrl } from '../src/bridge/config'
