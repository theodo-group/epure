// Wire protocol shared by every bridge host (standalone server, Vite plugin)
// and the client (`src/bridge`). Kept transport-agnostic: these are plain JSON
// frames carried over whatever WebSocket the host owns.
//
// A diagram is modelled as a *set of sidecar files*, each tagged with a `kind`.
// Every frame that carries file content is keyed by `kind`. Alongside the file
// frames, the socket also carries the ephemeral *live feedback* messages (the
// toolbar's pick/insert/text submissions and the agent's resolutions); those
// are not files and never touch disk — see the `Feedback*` types below.

export const PROTOCOL_VERSION = 1

/** The sidecar files that make up one diagram (the git-reviewable pair). */
export type FileKind = 'd2' | 'layout'

export const FILE_KINDS: readonly FileKind[] = ['d2', 'layout']

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

// ── Live feedback (ephemeral; never touches disk) ────────────────────────────
// The impeccable-style toolbar lets the user pick an element, drop an insert
// point, or just type, then Send. The submission rides this WebSocket to the
// server's in-memory queue; the host Claude Code drains it over HTTP long-poll
// (`/__epure/poll`) and edits the diagram. Resolutions come back over the
// socket. None of this is persisted — the edited pair is the durable artifact.

/** What a piece of feedback is about. */
export type FeedbackTarget =
  /** Pick: a node id, an edge key (`src->tgt`), or an area id. */
  | { kind: 'element'; ref: string }
  /** Insert: a net-new spot on the canvas, in grid units. */
  | { kind: 'point'; x: number; y: number }
  /** Textbar only: direction for the whole diagram. */
  | { kind: 'none' }

/** One feedback submission, as delivered to the agent over the poll. */
export interface FeedbackEvent {
  type: 'feedback'
  /** 8-char id minted by the browser so it can match the resolution. */
  id: string
  doc: string
  text: string
  target: FeedbackTarget
  /** ISO-8601 creation time. */
  createdAt: string
}

/** A poll either delivers an event, times out (re-poll), or signals the editor
 *  went away (the agent's loop should stop). */
export type PollResponse = FeedbackEvent | { type: 'timeout' } | { type: 'exit' }

/** The agent's verdict on one event. `done` even for a deliberate no-op (with a
 *  `message` the toolbar surfaces); `error` when it couldn't act. */
export interface FeedbackReply {
  id: string
  status: 'done' | 'error'
  message?: string
}

/** Browser → server: a toolbar submission. Gated behind a completed `hello`,
 *  exactly like `apply`. The server stamps nothing — the browser owns the id. */
export interface FeedbackMsg {
  type: 'feedback'
  doc: string
  id: string
  text: string
  target: FeedbackTarget
}

export type ClientMsg = HelloMsg | ApplyMsg | FeedbackMsg

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

/** Broadcast when an agent attaches to / detaches from the poll. Drives the
 *  toolbar's status dot (green = Claude is listening). True also while an event
 *  is mid-flight (delivered, not yet replied), so the dot stays green for the
 *  whole "Claude is editing" window, not just while it's parked on the poll. */
export interface FeedbackStatusMsg {
  type: 'feedbackStatus'
  agentPolling: boolean
}

/** Broadcast the instant the agent *drains* an event off the queue — i.e. Claude
 *  has actually received it and is now working. Drives the toolbar's transition
 *  from "Sent · waiting" to "Claude is thinking…", so the wait is never opaque. */
export interface FeedbackPickedUpMsg {
  type: 'feedbackPickedUp'
  id: string
}

/** Broadcast when the agent replies to an event. The toolbar matches by `id`
 *  and ignores ids it never submitted. */
export interface FeedbackResolvedMsg {
  type: 'feedbackResolved'
  id: string
  status: 'done' | 'error'
  message?: string
}

export type ServerMsg =
  | HydrateMsg
  | FileChangedMsg
  | AppliedMsg
  | RejectedMsg
  | FeedbackStatusMsg
  | FeedbackPickedUpMsg
  | FeedbackResolvedMsg
