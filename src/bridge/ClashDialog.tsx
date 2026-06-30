// Modal shown when the browser backup and the disk file have genuinely diverged
// (see offlineBackup.reconcile). The user must pick which version to keep — the
// other is discarded. Purely presentational; useBridge owns the resolution.

import type { ClashInfo } from './useBridge'

const ago = (epoch: number): string => {
  if (!epoch) return ''
  const s = Math.max(0, Math.round((Date.now() - epoch) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

const count = (c: { nodes: number; edges: number }) =>
  `${c.nodes} ${c.nodes === 1 ? 'node' : 'nodes'} · ${c.edges} ${c.edges === 1 ? 'edge' : 'edges'}`

export const ClashDialog = ({
  clash,
  onResolve,
}: {
  clash: ClashInfo
  onResolve: (choice: 'local' | 'disk') => void
}) => (
  <div className="ep-clash-backdrop" role="presentation">
    <div
      className="ep-clash"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ep-clash-title"
    >
      <h2 id="ep-clash-title" className="ep-clash-title">
        This diagram changed in two places
      </h2>
      <p className="ep-clash-body">
        Your browser has unsaved changes that differ from the file on disk (it was
        edited elsewhere while you were offline). Keep one — the other is discarded.
      </p>
      <div className="ep-clash-choices">
        <button type="button" className="ep-clash-choice" onClick={() => onResolve('local')}>
          <span className="ep-clash-choice-label">Keep my version</span>
          <span className="ep-clash-choice-meta">
            this browser{clash.localSavedAt ? ` · edited ${ago(clash.localSavedAt)}` : ''}
          </span>
          <span className="ep-clash-choice-meta">{count(clash.local)}</span>
        </button>
        <button type="button" className="ep-clash-choice" onClick={() => onResolve('disk')}>
          <span className="ep-clash-choice-label">Use the disk version</span>
          <span className="ep-clash-choice-meta">on disk now</span>
          <span className="ep-clash-choice-meta">{count(clash.disk)}</span>
        </button>
      </div>
    </div>
  </div>
)
