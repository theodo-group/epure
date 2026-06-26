// Floating comments panel: toggle comment mode, list/edit/resolve/delete pins,
// and hand the batch to Claude Code. Reads the comments store directly.
//
// Layout: anchored bottom-right but lifted ABOVE the canvas zoom dock (which
// owns bottom:16) so the two never collide. It hugs its content when collapsed
// and only takes a fixed width once the note list is showing. Chrome uses the
// shared --ep-* design tokens so it matches the dock it sits next to.

import { useState } from 'react'

import { useCommentsStore } from './store'

interface CommentsPanelProps {
  /** Diagram stem when bridged (e.g. `system`); enables "Send to Claude". */
  docName?: string
  bridged: boolean
}

// Comments is still under construction. While this is false the panel collapses
// to a disabled "coming soon" pill in the dock slot; flip it to true to restore
// the full feature exactly as before — that is the only change needed.
const COMMENTS_READY: boolean = false

const targetLabel = (ref: string | undefined): string => (ref ? ref : 'canvas')

// Comment-status colours are domain-specific (they match the canvas pins), so
// they stay literal rather than using the chrome tokens.
const STATUS_AMBER = '#f59e0b'
const STATUS_GREEN = '#22c55e'

export const CommentsPanel = ({ docName, bridged }: CommentsPanelProps) => {
  const comments = useCommentsStore((s) => s.comments)
  const commentMode = useCommentsStore((s) => s.commentMode)
  const selectedId = useCommentsStore((s) => s.selectedId)
  const setCommentMode = useCommentsStore((s) => s.setCommentMode)
  const selectComment = useCommentsStore((s) => s.selectComment)
  const updateBody = useCommentsStore((s) => s.updateBody)
  const setStatus = useCommentsStore((s) => s.setStatus)
  const removeComment = useCommentsStore((s) => s.removeComment)

  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)

  // Show the list whenever the user is placing or has a pin selected, even if
  // they last collapsed it — so a freshly-dropped pin is immediately editable.
  const expanded = open || commentMode || selectedId !== null
  const listVisible = expanded && comments.length > 0
  const openCount = comments.filter((c) => c.status === 'open').length

  const sendToClaude = async () => {
    const file = docName ? `${docName}.epr.comments.json` : 'the .epr.comments.json sidecar'
    const prompt = `Address the open comments in ${file}: read the file, edit the diagram pair to satisfy each open comment, then set its "status" to "resolved".`
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      /* clipboard may be blocked; the comments are on disk regardless */
    }
    setSent(true)
    setTimeout(() => setSent(false), 2600)
  }

  // Feature parked: hold the dock slot with a disabled placeholder until ready.
  if (!COMMENTS_READY) {
    return (
      <div
        className="ep-comments-panel"
        style={soonPillStyle}
        title="Comments — coming soon (feature not ready yet)"
        aria-disabled
      >
        <span aria-hidden="true" style={{ fontSize: 13, opacity: 0.55 }}>
          💬
        </span>
        <span style={{ fontWeight: 600, color: 'var(--ep-text-muted)' }}>Comments</span>
        <span style={soonTagStyle}>SOON</span>
      </div>
    )
  }

  return (
    <div
      className="ep-comments-panel"
      style={{ ...panelStyle, width: listVisible ? 340 : 'auto' }}
    >
      <div style={{ ...headerStyle, borderBottom: listVisible ? '1px solid var(--ep-border)' : 'none' }}>
        <button
          type="button"
          onClick={() => setCommentMode(!commentMode)}
          title="Drop comments on the diagram"
          style={modeBtnStyle(commentMode)}
        >
          💬 {commentMode ? 'Placing…' : 'Comment'}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} style={ghostBtn} title="Show comments">
          {comments.length} {comments.length === 1 ? 'note' : 'notes'} {expanded ? '▾' : '▸'}
        </button>
        {comments.length > 0 ? (
          <>
            <div style={{ flex: 1, minWidth: 8 }} />
            <button
              type="button"
              onClick={sendToClaude}
              disabled={openCount === 0}
              style={sendBtnStyle(openCount > 0)}
              title={bridged ? 'Copy a prompt to hand the comments to Claude Code' : 'Connect via `epure <file>` to share with Claude Code'}
            >
              {sent ? '✓ Copied' : `Send ${openCount} to Claude`}
            </button>
          </>
        ) : null}
      </div>

      {listVisible ? (
        <div style={listStyle}>
          {comments.map((c, i) => (
            <div
              key={c.id}
              onMouseDown={() => selectComment(c.id)}
              style={itemStyle(c.id === selectedId, c.status === 'resolved')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={badgeStyle(c.status)}>{i + 1}</span>
                <span style={{ fontSize: 11, color: 'var(--ep-text-muted)', fontFamily: 'var(--ep-mono)' }}>
                  {targetLabel(c.target.ref)}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setStatus(c.id, c.status === 'open' ? 'resolved' : 'open')}
                  style={ghostBtnSm}
                  title={c.status === 'open' ? 'Mark resolved' : 'Reopen'}
                >
                  {c.status === 'open' ? '✓' : '↺'}
                </button>
                <button type="button" onClick={() => removeComment(c.id)} style={ghostBtnSm} title="Delete">
                  ✕
                </button>
              </div>
              <textarea
                value={c.body}
                placeholder="What should change here?"
                onChange={(e) => updateBody(c.id, e.target.value)}
                onFocus={() => selectComment(c.id)}
                rows={2}
                style={textareaStyle}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── inline styles ────────────────────────────────────────────────────────────
// Chrome uses the shared --ep-* tokens (matching the zoom dock / style panel);
// status colours stay literal (they mirror the canvas pins).

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 16,
  bottom: 64, // lifted clear of the zoom dock (bottom:16, ~40px tall)
  maxWidth: 'calc(100% - 32px)',
  background: 'var(--ep-surface)',
  border: '1px solid var(--ep-border)',
  borderRadius: 10,
  boxShadow: 'var(--ep-shadow-card)',
  fontFamily: 'var(--ep-sans)',
  fontSize: 13,
  color: 'var(--ep-text)',
  zIndex: 20,
  overflow: 'hidden',
}
// Collapsed "coming soon" placeholder: same dock surface, hairline and 9px
// radius as the zoom dock it sits beside; muted ink and a mono SOON chip mark
// it as not-yet-active. Non-interactive (not-allowed) by design.
const soonPillStyle: React.CSSProperties = {
  position: 'absolute',
  right: 16,
  bottom: 64,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--ep-surface)',
  border: '1px solid var(--ep-border)',
  borderRadius: 9,
  boxShadow: 'var(--ep-shadow-card)',
  fontFamily: 'var(--ep-sans)',
  fontSize: 13,
  color: 'var(--ep-text)',
  cursor: 'not-allowed',
  userSelect: 'none',
  zIndex: 20,
}
const soonTagStyle: React.CSSProperties = {
  fontFamily: 'var(--ep-mono)',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: 0.5,
  color: 'var(--ep-text-muted)',
  border: '1px solid var(--ep-border)',
  borderRadius: 4,
  padding: '1px 5px',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 8,
  whiteSpace: 'nowrap',
}
const listStyle: React.CSSProperties = { maxHeight: 320, overflowY: 'auto', padding: 6 }

const btnBase: React.CSSProperties = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  border: 'none',
  borderRadius: 8,
  padding: '5px 10px',
  fontWeight: 600,
  cursor: 'pointer',
}
const modeBtnStyle = (active: boolean): React.CSSProperties => ({
  ...btnBase,
  minWidth: 96, // reserve for "Placing…" so toggling doesn't shift the row
  textAlign: 'center',
  background: active ? STATUS_AMBER : 'var(--ep-bg)',
  color: active ? '#ffffff' : 'var(--ep-text-tertiary)',
})
const sendBtnStyle = (enabled: boolean): React.CSSProperties => ({
  ...btnBase,
  cursor: enabled ? 'pointer' : 'default',
  background: enabled ? 'var(--ep-accent)' : 'var(--ep-bg)',
  color: enabled ? '#ffffff' : 'var(--ep-text-subtle)',
})
const ghostBtn: React.CSSProperties = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--ep-text-muted)',
  fontSize: 12,
}
const ghostBtnSm: React.CSSProperties = { ...ghostBtn, padding: '2px 4px', lineHeight: 1, fontSize: 13 }
const itemStyle = (selected: boolean, resolved: boolean): React.CSSProperties => ({
  border: `1px solid ${selected ? 'var(--ep-accent-border)' : 'var(--ep-border)'}`,
  borderRadius: 8,
  padding: 7,
  marginBottom: 6,
  background: resolved ? 'var(--ep-app)' : 'var(--ep-surface)',
  opacity: resolved ? 0.7 : 1,
})
const badgeStyle = (status: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: status === 'resolved' ? STATUS_GREEN : STATUS_AMBER,
  color: '#ffffff',
  fontSize: 11,
  fontWeight: 700,
})
const textareaStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--ep-border-soft)',
  borderRadius: 6,
  padding: 6,
  fontSize: 12,
  resize: 'vertical',
  fontFamily: 'var(--ep-sans)',
  color: 'var(--ep-text)',
  background: 'var(--ep-surface)',
  boxSizing: 'border-box',
}
