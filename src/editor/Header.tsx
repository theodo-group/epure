import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  useDiagramStore,
  useTemporalStore,
  type ExportScale,
} from '@/store/diagramStore'
import {
  openWithFileSystemAccess,
  saveWithFileSystemAccess,
} from '@/file/zip'

interface HeaderProps {
  onExportPng: () => Promise<void> | void
  onExportHtml: () => Promise<void> | void
  saveHandleRef: React.MutableRefObject<FileSystemFileHandle | undefined>
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

export const Header = ({ onExportPng, onExportHtml, saveHandleRef }: HeaderProps) => {
  const filename = useDiagramStore((s) => s.filename)
  const dirty = useDiagramStore((s) => s.dirty)
  const exportScale = useDiagramStore((s) => s.exportScale)
  const source = useDiagramStore((s) => s.source)
  const layout = useDiagramStore((s) => s.layout)
  const setFilename = useDiagramStore((s) => s.setFilename)
  const setExportScale = useDiagramStore((s) => s.setExportScale)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const markClean = useDiagramStore((s) => s.markClean)

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

  const onOpen = useCallback(async () => {
    try {
      const doc = await openWithFileSystemAccess()
      if (!doc) return
      saveHandleRef.current = doc.handle
      loadDocument(doc.source, doc.layout, doc.filename)
    } catch (err) {
      console.error('open failed', err)
    }
  }, [loadDocument, saveHandleRef])

  const onSave = useCallback(async () => {
    try {
      const handle = await saveWithFileSystemAccess(
        saveHandleRef.current,
        source,
        layout,
        filename,
      )
      if (handle) saveHandleRef.current = handle
      markClean()
    } catch (err) {
      console.error('save failed', err)
    }
  }, [source, layout, filename, markClean, saveHandleRef])

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
    <header className="ag-header">
      <div className="ag-logo" aria-label="archgrid">
        d2
      </div>

      <div className="ag-vrule" />

      <div className="ag-crumb">
        <span className="ag-crumb-root">arch</span>
        <span className="ag-crumb-sep">/</span>
        <input
          className="ag-crumb-name"
          value={`${filename}.d2`}
          onChange={(e) => {
            const v = e.target.value.replace(/\.d2$/, '')
            setFilename(v || 'untitled')
          }}
          spellCheck={false}
          size={Math.max(8, filename.length + 3)}
          aria-label="filename"
        />
        <span className={`ag-pill ${dirty ? 'ag-pill-unsaved' : 'ag-pill-saved'}`}>
          <span className="ag-pill-dot" />
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      <div className="ag-spacer" />

      <button
        className="ag-btn ag-btn-ghost ag-btn-icon"
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
        className="ag-btn ag-btn-ghost ag-btn-icon"
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

      <div className="ag-vrule" />

      <button className="ag-btn ag-btn-ghost" onClick={onOpen} type="button">
        Open
      </button>
      <button className="ag-btn ag-btn-ghost" onClick={onSave} type="button">
        {dirty ? 'Save*' : 'Share'}
      </button>

      <div className="ag-menu-wrap" ref={exportRef}>
        <button
          className="ag-btn ag-btn-primary"
          onClick={() => setExportOpen((o) => !o)}
          type="button"
        >
          Export
          <ChevronDown />
        </button>
        {exportOpen ? (
          <div className="ag-menu" role="menu">
            <button onClick={handleExportPng}>
              Export PNG <span className="ag-menu-kbd">⌘E</span>
            </button>
            <div className="ag-menu-sep" />
            <button onClick={handleExportHtml}>Export standalone HTML</button>
            <div className="ag-menu-sep" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 10px',
                fontSize: 12,
                color: 'var(--ag-text-muted)',
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
                      border: '1px solid var(--ag-border)',
                      background: exportScale === s ? 'var(--ag-accent-bg)' : '#fff',
                      color:
                        exportScale === s
                          ? 'var(--ag-accent-deep)'
                          : 'var(--ag-text)',
                      fontSize: 11,
                      fontFamily: 'var(--ag-mono)',
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

      <div className="ag-avatar" aria-hidden />
    </header>
  )
}
