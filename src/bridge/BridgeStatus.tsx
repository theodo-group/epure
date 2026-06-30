// Presentational bridge status pill, rendered in the Footer. Purely reflects
// `useBridge()` state — never blocks input. Hidden entirely in standalone mode
// so the Pages build looks exactly as it does today.

import type { BridgeUiState } from './useBridge'

const dotColor = (state: BridgeUiState): string => {
  if (state.usingLocalCopy) return 'var(--ep-warn, #d08700)'
  if (state.remoteError) return 'var(--ep-warn, #d08700)'
  if (state.status === 'connected') return 'var(--ep-ok, #2a9d4a)'
  if (state.status === 'connecting') return 'var(--ep-muted, #9aa0a6)'
  return 'var(--ep-error, #c0392b)' // disconnected
}

const label = (state: BridgeUiState): string => {
  // Showing the browser backup because the server is unreachable — say so, since
  // edits are held locally until it reconnects.
  if (state.usingLocalCopy) return `${state.filename || 'diagram'} — offline (local copy)`
  if (state.status === 'connecting') return 'connecting…'
  if (state.status === 'disconnected') return 'disconnected'
  if (state.remoteError) return `${state.filename} — disk invalid`
  if (state.invalidUnsaved) return `${state.filename} — unsaved (invalid syntax)`
  if (state.diskChanged) return `${state.filename} — disk changed`
  if (state.flash) return `${state.filename} — reloaded from disk`
  return state.filename
}

// The save cue rides alongside the filename in the calm connected state. When the
// label is already explaining something more urgent (connecting/disconnected,
// disk invalid/changed, just-reloaded, or unsaved-invalid syntax) it's that
// message's job to inform — so the cue stays out of the way.
const showSaveCue = (state: BridgeUiState): boolean =>
  state.status === 'connected' &&
  !state.remoteError &&
  !state.diskChanged &&
  !state.flash &&
  !state.invalidUnsaved

const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
    <path
      d="M2.5 6.5 L5 9 L9.5 3.5"
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const SaveCue = ({ state }: { state: BridgeUiState }) => {
  if (!showSaveCue(state)) return null
  const base = { display: 'inline-flex', alignItems: 'center', gap: 3 } as const
  if (state.saveState === 'saving') {
    return (
      <span style={{ ...base, color: 'var(--ep-muted, #9aa0a6)' }} title="Saving changes to disk…">
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ep-warn, #d08700)' }}
        />
        Saving…
      </span>
    )
  }
  // 'saved' is the only other state reachable once showSaveCue() is true.
  return (
    <span style={{ ...base, color: 'var(--ep-ok, #2a9d4a)' }} title="All changes saved to disk">
      <CheckIcon />
      Saved
    </span>
  )
}

export const BridgeStatus = ({ state }: { state: BridgeUiState }) => {
  if (!state.active) return null
  return (
    <span
      className="ep-bridge-status"
      title={`Épure bridge: ${state.status}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dotColor(state),
          transition: 'background 150ms',
        }}
      />
      <span>{label(state)}</span>
      <SaveCue state={state} />
    </span>
  )
}
