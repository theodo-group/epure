// `@theodo-group/epure/bridge` — the host-side surface of the live bridge: the
// wire protocol (plain JSON frames, see src/bridge/protocol.ts) plus the
// postMessage envelope helpers. A page that embeds the editor in an iframe or
// popup (`#bridge=pm&origin=<its origin>&token=<nonce>`) implements the server
// role with these: answer `hello` with `hydrate`, receive `apply`, ack with
// `applied`. Types, constants and tiny pure functions only — no DOM touched at
// import time, safe in Node and the browser alike.

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
} from '../src/bridge/protocol'
export { PM_ENVELOPE_KEY, readPmFrame } from '../src/bridge/postMessageSocket'
