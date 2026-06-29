import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  useDiagramStore,
  useTemporalStore,
  type ExportScale,
} from '@/store/diagramStore'

interface HeaderProps {
  onOpen: () => Promise<void> | void
  onExportPng: () => Promise<void> | void
  onExportHtml: () => Promise<void> | void
}

const SCALES: ExportScale[] = [1, 2, 4]

const ChevronDown = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path
      d="M2 4 L5 7 L8 4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const Header = ({ onOpen, onExportPng, onExportHtml }: HeaderProps) => {
  const exportScale = useDiagramStore((s) => s.exportScale)
  const setExportScale = useDiagramStore((s) => s.setExportScale)

  const canUndo = useStore(useTemporalStore, (t) => t.pastStates.length > 0)
  const canRedo = useStore(useTemporalStore, (t) => t.futureStates.length > 0)

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!exportOpen) return
    const onClick = (e: globalThis.MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  const handleExportPng = async () => {
    setExportOpen(false)
    try {
      await onExportPng()
    } catch (err) {
      console.error('export png failed', err)
    }
  }

  const handleExportHtml = async () => {
    setExportOpen(false)
    try {
      await onExportHtml()
    } catch (err) {
      console.error('export html failed', err)
    }
  }

  return (
    <header className="ep-header">
      <div className="ep-logo" aria-label="Épure">
        d2
      </div>

      <div className="ep-spacer" />

      <button
        className="ep-btn ep-btn-ghost ep-btn-icon"
        onClick={() => useTemporalStore.getState().undo()}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        type="button"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M6 4 L3 7 L6 10 M3 7 H10 a3 3 0 0 1 0 6 H7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="ep-btn ep-btn-ghost ep-btn-icon"
        onClick={() => useTemporalStore.getState().redo()}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        type="button"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M10 4 L13 7 L10 10 M13 7 H6 a3 3 0 0 0 0 6 H9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="ep-vrule" />

      <button className="ep-btn ep-btn-ghost" onClick={onOpen} type="button">
        Open
      </button>

      <div className="ep-menu-wrap" ref={exportRef}>
        <button
          className="ep-btn ep-btn-primary"
          onClick={() => setExportOpen((o) => !o)}
          type="button"
        >
          Export
          <ChevronDown />
        </button>
        {exportOpen ? (
          <div className="ep-menu" role="menu">
            <button onClick={handleExportPng}>
              Export PNG <span className="ep-menu-kbd">⌘E</span>
            </button>
            <div className="ep-menu-sep" />
            <button onClick={handleExportHtml}>Export standalone HTML</button>
            <div className="ep-menu-sep" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 10px',
                fontSize: 12,
                color: 'var(--ep-text-muted)',
              }}
            >
              <span>PNG scale</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {SCALES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setExportScale(s)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid var(--ep-border)',
                      background: exportScale === s ? 'var(--ep-accent-bg)' : '#fff',
                      color:
                        exportScale === s
                          ? 'var(--ep-accent-deep)'
                          : 'var(--ep-text)',
                      fontSize: 11,
                      fontFamily: 'var(--ep-mono)',
                      cursor: 'pointer',
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ep-avatar" aria-hidden />
    </header>
  )
}
