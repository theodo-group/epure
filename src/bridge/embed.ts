// The host tier of the bridge: `embed(iframe, ...)` puts a diagram pair in
// the hosted editor and hands every edit back. Hosts get the job, not the
// wire: the session token, the URL, the pinned listener, the hello/hydrate
// handshake, the applied acks and the rejections all live here. The wire tier
// (protocol types, wrap/unwrap, bridgeUrl) stays exported for hosts that need
// custom policies.

import { unwrap, wrap } from './channel'
import { bridgeUrl } from './config'
import { PROTOCOL_VERSION, type BridgeMsg, type FileKind, type ServerMsg } from './protocol'

/** The pair as a host sees it. `layout` null = absent (the editor synthesizes
 *  its default and echoes one back only once the user edits). */
export type Files = { d2: string; layout: string | null }

export type EmbedOptions = {
  /** The hosted editor, e.g. 'https://theodo-group.github.io/epure/'. */
  app: string
  /** Diagram stem: the editor's tab-bar name, echoed in every frame. */
  doc: string
  /** Initial content. */
  files: { d2: string; layout?: string | null }
  /** Fires after each recorded edit; `changed` lists the kinds it carried. */
  onChange?: (files: Files, changed: FileKind[]) => void
  /** Fires when the editor completes the handshake (again after a reload). */
  onConnect?: () => void
}

export interface Session {
  /** The latest content, updated by every recorded edit. */
  files(): Files
  /** Whether any edit landed since `embed`. */
  dirty(): boolean
  /** Stop listening. The iframe itself is the caller's to unmount. */
  close(): void
}

type State = {
  token: string
  doc: string
  files: Files
  dirty: boolean
  connected: boolean
}

/**
 * The server role as a pure reducer: one message in, next state and replies
 * out. Exported for tests; hosts use `embed`.
 *
 *  - `hello`: token checked first (`rejected unauthorized` otherwise), then
 *    protocol; a good hello always answers with a `hydrate` carrying the
 *    CURRENT content, so a reloading editor resumes from the latest edit.
 *  - `apply`: records each well-formed kind, marks dirty, acks with `applied`.
 *  - Anything else (an echoed server message, a malformed files list) is
 *    ignored: same state, no replies.
 */
export const advance = (
  state: State,
  msg: BridgeMsg,
): { state: State; replies: ServerMsg[]; changed: FileKind[] } => {
  if (msg.type === 'hello') {
    if (msg.token !== state.token) {
      return {
        state,
        replies: [{ type: 'rejected', doc: state.doc, reason: 'unauthorized' }],
        changed: [],
      }
    }
    if (msg.protocol !== PROTOCOL_VERSION) {
      return {
        state,
        replies: [
          {
            type: 'rejected',
            doc: state.doc,
            reason: 'protocol',
            error: `Protocol ${msg.protocol} is not supported; this host speaks version ${PROTOCOL_VERSION}.`,
          },
        ],
        changed: [],
      }
    }
    return {
      state: { ...state, connected: true },
      replies: [
        {
          type: 'hydrate',
          doc: state.doc,
          files: [
            { kind: 'd2', content: state.files.d2, valid: true },
            { kind: 'layout', content: state.files.layout, valid: true },
          ],
        },
      ],
      changed: [],
    }
  }

  if (msg.type === 'apply') {
    // The types say `files` is a list of tagged contents; the wire may
    // disagree, so each entry earns its way in.
    if (!Array.isArray(msg.files)) return { state, replies: [], changed: [] }
    let files = state.files
    const changed: FileKind[] = []
    for (const file of msg.files) {
      if ((file.kind !== 'd2' && file.kind !== 'layout') || typeof file.content !== 'string') {
        continue
      }
      changed.push(file.kind)
      files =
        file.kind === 'd2' ? { ...files, d2: file.content } : { ...files, layout: file.content }
    }
    return {
      state: changed.length > 0 ? { ...state, files, dirty: true } : state,
      replies: [{ type: 'applied', doc: state.doc, kinds: changed }],
      changed,
    }
  }

  return { state, replies: [], changed: [] }
}

/**
 * Put a diagram pair in the hosted editor and receive every edit back:
 *
 *   const session = embed(iframe, { app, doc, files: { d2, layout }, onChange })
 *
 * Owns the whole host mechanism: mints the session token, points the iframe at
 * `bridgeUrl`, pins the listener to the editor's origin and window, answers
 * `hello` with the current content, records each `apply` and acks it.
 * Persistence stays the caller's one decision: save in `onChange` for a live
 * feel, or read `files()` once, on close, for a single commit.
 */
export const embed = (iframe: HTMLIFrameElement, opts: EmbedOptions): Session => {
  const appOrigin = new URL(opts.app, window.location.href).origin
  let state: State = {
    token: crypto.randomUUID(),
    doc: opts.doc,
    files: { d2: opts.files.d2, layout: opts.files.layout ?? null },
    dirty: false,
    connected: false,
  }
  const onMessage = (event: MessageEvent) => {
    const editor = iframe.contentWindow
    if (!editor || event.origin !== appOrigin || event.source !== editor) return
    const msg = unwrap(event.data)
    if (msg === null) return
    const result = advance(state, msg)
    state = result.state
    for (const reply of result.replies) editor.postMessage(wrap(reply), appOrigin)
    if (result.changed.length > 0) opts.onChange?.(state.files, result.changed)
    if (msg.type === 'hello' && result.replies[0]?.type === 'hydrate') opts.onConnect?.()
  }
  window.addEventListener('message', onMessage)
  iframe.src = bridgeUrl(opts.app, {
    origin: window.location.origin,
    token: state.token,
    doc: opts.doc,
  })
  return {
    files: () => state.files,
    dirty: () => state.dirty,
    close: () => window.removeEventListener('message', onMessage),
  }
}
