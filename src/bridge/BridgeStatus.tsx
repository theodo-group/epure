// Presentational bridge status pill, rendered in the Footer. Purely reflects
// `useBridge()` state — never blocks input. Hidden entirely in standalone mode
// so the Pages build looks exactly as it does today.

import type { BridgeUiState } from './useBridge'

const dotColor = (state: BridgeUiState): string => {
  if (state.remoteError) return 'var(--ep-warn, #d08700)'
  if (state.status === 'connected') return 'var(--ep-ok, #2a9d4a)'
  if (state.status === 'connecting') return 'var(--ep-muted, #9aa0a6)'
  return 'var(--ep-error, #c0392b)' // disconnected
}

const label = (state: BridgeUiState): string => {
  if (state.status === 'connecting') return 'connecting…'
  if (state.status === 'disconnected') return 'disconnected'
  if (state.remoteError) return `${state.filename} — disk invalid`
  if (state.invalidUnsaved) return `${state.filename} — unsaved (invalid syntax)`
  if (state.diskChanged) return `${state.filename} — disk changed`
  if (state.flash) return `${state.filename} — reloaded from disk`
  return state.filename
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
    </span>
  )
}
