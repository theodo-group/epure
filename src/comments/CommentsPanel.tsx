// Floating comments panel: toggle comment mode, list/edit/resolve/delete pins,
// and hand the batch to Claude Code. Reads the comments store directly.

import { useState } from 'react'

import { useCommentsStore } from './store'

interface CommentsPanelProps {
  /** Diagram stem when bridged (e.g. `system`); enables "Send to Claude". */
  docName?: string
  bridged: boolean
}

const targetLabel = (ref: string | undefined): string => (ref ? ref : 'canvas')

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

  return (
    <div className="ep-comments-panel" style={panelStyle}>
      <div style={headerStyle}>
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
        <div style={{ flex: 1 }} />
        {comments.length > 0 ? (
          <button
            type="button"
            onClick={sendToClaude}
            disabled={openCount === 0}
            style={sendBtnStyle(openCount > 0)}
            title={bridged ? 'Copy a prompt to hand the comments to Claude Code' : 'Connect via `epure <file>` to share with Claude Code'}
          >
            {sent ? '✓ Copied' : `Send ${openCount} to Claude`}
          </button>
        ) : null}
      </div>

      {expanded && comments.length > 0 ? (
        <div style={listStyle}>
          {comments.map((c, i) => (
            <div
              key={c.id}
              onMouseDown={() => selectComment(c.id)}
              style={itemStyle(c.id === selectedId, c.status === 'resolved')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={badgeStyle(c.status)}>{i + 1}</span>
                <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
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

// ── inline styles (kept local; consistent with BridgeStatus) ─────────────────

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  width: 280,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  boxShadow: '0 4px 16px rgba(15,23,42,0.12)',
  fontSize: 13,
  zIndex: 20,
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 8,
  borderBottom: '1px solid #f1f5f9',
}
const listStyle: React.CSSProperties = { maxHeight: 320, overflowY: 'auto', padding: 6 }
const modeBtnStyle = (active: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: 7,
  padding: '5px 9px',
  cursor: 'pointer',
  fontWeight: 600,
  background: active ? '#f59e0b' : '#f1f5f9',
  color: active ? '#ffffff' : '#334155',
})
const sendBtnStyle = (enabled: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: 7,
  padding: '5px 9px',
  cursor: enabled ? 'pointer' : 'default',
  fontWeight: 600,
  background: enabled ? '#3b82f6' : '#e5e7eb',
  color: enabled ? '#ffffff' : '#9ca3af',
})
const ghostBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: '#475569',
  fontSize: 12,
}
const ghostBtnSm: React.CSSProperties = { ...ghostBtn, padding: '2px 4px', lineHeight: 1 }
const itemStyle = (selected: boolean, resolved: boolean): React.CSSProperties => ({
  border: `1px solid ${selected ? '#93c5fd' : '#eef2f7'}`,
  borderRadius: 8,
  padding: 7,
  marginBottom: 6,
  background: resolved ? '#f8fafc' : '#ffffff',
  opacity: resolved ? 0.7 : 1,
})
const badgeStyle = (status: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: status === 'resolved' ? '#22c55e' : '#f59e0b',
  color: '#ffffff',
  fontSize: 11,
  fontWeight: 700,
})
const textareaStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 6,
  fontSize: 12,
  resize: 'vertical',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
