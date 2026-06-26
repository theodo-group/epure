// The live-feedback bar — Épure's take on impeccable's toolbar, pared to what
// the user asked for: a Pick tool, an Insert tool, and a textbar. The user picks
// an element (or drops an insert point), types what should change, and Sends;
// the note rides the WebSocket to the server's queue, the host Claude Code
// drains it over `epure poll`, edits the pair, and replies — the result shows
// inline here. Nothing is persisted; the edited diagram is the artifact.
//
// Floats top-center: the tool palette owns top-left, the StylePanel top-right,
// the zoom dock the bottom — top-center is the one uncontested edge.

import { useEffect, useRef } from 'react'

import type { FeedbackUi } from './useFeedback'

const targetLabel = (t: FeedbackUi['target']): string => {
  if (!t) return ''
  if (t.kind === 'element') return t.ref
  if (t.kind === 'point') return 'point'
  return ''
}

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null
  return (
    !!node &&
    (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)
  )
}

export const FeedbackToolbar = ({ fb }: { fb: FeedbackUi }) => {
  const inputRef = useRef<HTMLInputElement>(null)

  // Global shortcuts: P/I toggle the tools when not typing; Esc cancels the
  // active mode and clears the target. (Cmd-shortcuts live in App and are
  // mod-gated, so plain p/i never collide with them.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc in the feedback input dismisses it; Esc while typing elsewhere
        // (the code editor) must NOT wipe a picked target. Only cancel from a
        // non-typing context, and only when something is actually active.
        if (isTypingTarget(e.target)) {
          if (e.target === inputRef.current) inputRef.current?.blur()
          return
        }
        if (fb.mode !== 'off' || fb.target) {
          fb.cancelMode()
          fb.clearTarget()
        }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (e.key === 'p') {
        e.preventDefault()
        fb.toggleMode('pick')
      } else if (e.key === 'i') {
        e.preventDefault()
        fb.toggleMode('insert')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fb])

  const tLabel = targetLabel(fb.target)
  const dotTitle = fb.agentPolling
    ? 'Claude is listening for feedback'
    : 'No agent attached — run `epure poll <file>` so Claude receives feedback'

  return (
    <div className="ep-feedback-bar" style={barStyle}>
      <span
        className={`ep-fb-dot${fb.agentPolling ? ' ep-fb-dot--on' : ' ep-fb-dot--idle'}`}
        title={dotTitle}
        style={dotStyle(fb.agentPolling)}
      />

      <button
        type="button"
        onClick={() => fb.toggleMode('pick')}
        title="Pick an element to attach feedback to (P)"
        style={toolBtnStyle(fb.mode === 'pick', fb.target?.kind === 'element')}
      >
        ◎ Pick
      </button>
      <button
        type="button"
        onClick={() => fb.toggleMode('insert')}
        title="Drop a point for net-new content (I)"
        style={toolBtnStyle(fb.mode === 'insert', fb.target?.kind === 'point')}
      >
        ＋ Insert
      </button>

      {tLabel ? (
        <span style={chipStyle} title="Feedback anchor">
          → {tLabel}
          <button type="button" onClick={fb.clearTarget} title="Detach" style={chipClearStyle}>
            ✕
          </button>
        </span>
      ) : null}

      <div style={dividerStyle} />

      <input
        ref={inputRef}
        value={fb.text}
        onChange={(e) => fb.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            fb.send()
          }
        }}
        placeholder={
          fb.mode === 'pick'
            ? 'Click an element, then say what to change…'
            : fb.mode === 'insert'
              ? 'Click where to add, then describe it…'
              : 'Tell Claude what to change…'
        }
        style={inputStyle}
      />

      <button
        type="button"
        onClick={fb.send}
        disabled={!fb.canSend || fb.phase !== null}
        title="Send to Claude (Enter)"
        style={sendBtnStyle(fb.canSend && fb.phase === null)}
      >
        {fb.phase !== null ? '…' : 'Send'}
      </button>

      {fb.phase ?? fb.result ? <FeedbackStatus fb={fb} /> : null}
    </div>
  )
}

// Sent · waiting → Claude is thinking… → ✓ done / ⚠ error. Three distinct,
// legible states so the wait is never a mystery.
const FeedbackStatus = ({ fb }: { fb: FeedbackUi }) => {
  if (fb.phase === 'queued') {
    return (
      <span style={statusStyle()}>
        {fb.agentPolling ? 'Sent · waiting for Claude…' : 'Sent · no agent attached'}
      </span>
    )
  }
  if (fb.phase === 'thinking') {
    return (
      <span className="ep-fb-thinking" style={{ ...statusStyle(), color: 'var(--ep-accent)' }}>
        ✦ Claude is thinking…
      </span>
    )
  }
  if (fb.result) {
    return (
      <span style={statusStyle(fb.result.status)}>
        {fb.result.status === 'error'
          ? `⚠ ${fb.result.message ?? 'could not apply'}`
          : `✓ ${fb.result.message ?? 'done'}`}
      </span>
    )
  }
  return null
}

// ── inline styles (shared --ep-* chrome tokens; status colours are literal) ──

const ACCENT = 'var(--ep-accent)'

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: 'calc(100% - 32px)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  background: 'var(--ep-surface)',
  border: '1px solid var(--ep-border)',
  borderRadius: 10,
  boxShadow: 'var(--ep-shadow-card)',
  fontFamily: 'var(--ep-sans)',
  fontSize: 13,
  color: 'var(--ep-text)',
  zIndex: 20,
}

const dotStyle = (on: boolean): React.CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: '50%',
  flexShrink: 0,
  margin: '0 2px',
  background: on ? '#22c55e' : '#f59e0b',
})

const toolBtnStyle = (active: boolean, hasTarget: boolean): React.CSSProperties => ({
  flexShrink: 0,
  whiteSpace: 'nowrap',
  border: active || hasTarget ? `1px solid ${ACCENT}` : '1px solid var(--ep-border)',
  borderRadius: 8,
  padding: '5px 9px',
  fontWeight: 600,
  cursor: 'pointer',
  background: active ? ACCENT : hasTarget ? 'var(--ep-accent-soft, var(--ep-bg))' : 'var(--ep-bg)',
  color: active ? '#ffffff' : 'var(--ep-text-tertiary)',
})

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  padding: '3px 6px',
  borderRadius: 6,
  background: 'var(--ep-bg)',
  color: 'var(--ep-text-muted)',
  fontSize: 12,
  fontFamily: 'var(--ep-mono)',
}
const chipClearStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--ep-text-muted)',
  padding: 0,
  lineHeight: 1,
  fontSize: 12,
}

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'var(--ep-border)',
  margin: '2px 2px',
}

const inputStyle: React.CSSProperties = {
  width: 260,
  maxWidth: '40vw',
  border: '1px solid var(--ep-border-soft)',
  borderRadius: 7,
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'var(--ep-sans)',
  color: 'var(--ep-text)',
  background: 'var(--ep-surface)',
  boxSizing: 'border-box',
}

const sendBtnStyle = (enabled: boolean): React.CSSProperties => ({
  flexShrink: 0,
  border: 'none',
  borderRadius: 8,
  padding: '6px 12px',
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'default',
  background: enabled ? ACCENT : 'var(--ep-bg)',
  color: enabled ? '#ffffff' : 'var(--ep-text-subtle)',
})

const statusStyle = (status?: 'done' | 'error'): React.CSSProperties => ({
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: 12,
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color:
    status === 'error' ? '#ef4444' : status === 'done' ? '#22c55e' : 'var(--ep-text-muted)',
})
