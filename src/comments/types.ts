// Review comments that ride a third sidecar, `<name>.epr.comments.json`. The
// user drops them on the diagram in the editor; Claude Code reads the file,
// edits the pair, and flips each to `resolved`. Files-as-API — no new protocol.

export type CommentStatus = 'open' | 'resolved'

export interface CommentTarget {
  /**
   * What the comment is about: a node id, an edge key (`src->tgt`), or an area
   * id. Optional because a comment can be dropped on empty canvas. When it
   * resolves to a live element the pin anchors to it; otherwise it falls back
   * to {x,y} and is flagged target-missing.
   */
  ref?: string
  /** Last-known position in grid units — the orphan fallback, baked in now. */
  x: number
  y: number
}

export interface EprComment {
  /** Stable id; never reused. */
  id: string
  body: string
  status: CommentStatus
  /** ISO-8601 creation time. */
  createdAt: string
  /** Who wrote it. `user` from the editor; `claude` if CC ever annotates back. */
  author?: 'user' | 'claude'
  target: CommentTarget
}

export interface EprCommentsFile {
  version: 1
  comments: EprComment[]
}
