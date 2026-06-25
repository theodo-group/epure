// Wire protocol shared by every bridge host (standalone server, Vite plugin)
// and the client (`src/bridge`). Kept transport-agnostic: these are plain JSON
// frames carried over whatever WebSocket the host owns.
//
// A diagram is modelled as a *set of sidecar files*, each tagged with a `kind`.
// Every frame that carries file content is keyed by `kind`, which is the single
// design decision that makes the future comments sidecar additive: it rides the
// existing frames with `kind: 'comments'` and needs no new message types.

export const PROTOCOL_VERSION = 1

/** The sidecar files that make up one diagram. `comments` is reserved for a
 *  future feature (designed, not yet shipped) and already flows end-to-end. */
export type FileKind = 'd2' | 'layout' | 'comments'

export const FILE_KINDS: readonly FileKind[] = ['d2', 'layout', 'comments']

/** A single sidecar's content plus its validation verdict. `content` is null
 *  only when the file is absent on disk. `valid:false` means present but
 *  mid-write / malformed — the client keeps its last-good copy. */
export interface FileFrame {
  kind: FileKind
  content: string | null
  valid: boolean
  error?: string
}

// ── Client → Server ─────────────────────────────────────────────────────────

export interface HelloMsg {
  type: 'hello'
  protocol: number
  token: string
  /** basename stem of the pair, echoed back for sanity (single-doc per server). */
  doc: string
}

/** A coherent multi-file edit from the UI. Only the dirty kinds are included;
 *  the server writes them as one back-to-back rename batch. `kind` is an enum,
 *  never a path — the server alone maps it to a confined file. */
export interface ApplyMsg {
  type: 'apply'
  doc: string
  files: { kind: FileKind; content: string }[]
}

export type ClientMsg = HelloMsg | ApplyMsg

// ── Server → Client ─────────────────────────────────────────────────────────

export interface HydrateMsg {
  type: 'hydrate'
  doc: string
  files: FileFrame[]
}

export interface FileChangedMsg {
  type: 'fileChanged'
  doc: string
  kind: FileKind
  content: string | null
  valid: boolean
  error?: string
}

export interface AppliedMsg {
  type: 'applied'
  doc: string
  kinds: FileKind[]
}

export interface RejectedMsg {
  type: 'rejected'
  doc: string
  reason: 'invalid' | 'protocol' | 'unauthorized'
  error?: string
}

export type ServerMsg = HydrateMsg | FileChangedMsg | AppliedMsg | RejectedMsg
