// `@theodo-group/epure/bridge`: embed the hosted editor in your page.
//
//   const session = embed(iframe, { app, doc, files: { d2, layout }, onChange })
//
// `embed` owns the whole host mechanism: the session token, the URL, the
// listener pinned to the editor's origin and window, the handshake and the
// acks. The wire tier below it (protocol types, wrap/unwrap, bridgeUrl) stays
// exported for hosts that need custom policies. Nothing touches the DOM at
// import time; the wire tier is safe in Node too.

export { embed, type EmbedOptions, type Files, type Session } from '../src/bridge/embed'
export { bridgeUrl } from '../src/bridge/config'
export { wrap, unwrap } from '../src/bridge/channel'
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
