import { useCallback, useRef } from 'react'
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

const SCALES: ExportScale[] = [1, 2, 4]

interface ToolbarProps {
  onExportPng: () => Promise<void> | void
  onExportHtml: () => Promise<void> | void
  onFitView: () => void
  getSvg: () => SVGSVGElement | null
}

export const Toolbar = ({ onExportPng, onExportHtml, onFitView, getSvg }: ToolbarProps) => {
  const source = useDiagramStore((s) => s.source)
  const layout = useDiagramStore((s) => s.layout)
  const routed = useDiagramStore((s) => s.routed)
  const filename = useDiagramStore((s) => s.filename)
  const showGrid = useDiagramStore((s) => s.showGrid)
  const gridSize = useDiagramStore((s) => s.gridSize)
  const exportScale = useDiagramStore((s) => s.exportScale)
  const dirty = useDiagramStore((s) => s.dirty)

  const setExportScale = useDiagramStore((s) => s.setExportScale)
  const toggleGrid = useDiagramStore((s) => s.toggleGrid)
  const setGridSize = useDiagramStore((s) => s.setGridSize)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const markClean = useDiagramStore((s) => s.markClean)
  const setFilename = useDiagramStore((s) => s.setFilename)

  const canUndo = useStore(useTemporalStore, (t) => t.pastStates.length > 0)
  const canRedo = useStore(useTemporalStore, (t) => t.futureStates.length > 0)

  const handleRef = useRef<FileSystemFileHandle | undefined>(undefined)

  const onOpen = useCallback(async () => {
    try {
      const doc = await openWithFileSystemAccess()
      if (!doc) return
      handleRef.current = doc.handle
      loadDocument(doc.source, doc.layout, doc.filename)
    } catch (err) {
      console.error('open failed', err)
      alert(`Failed to open file: ${(err as Error).message}`)
    }
  }, [loadDocument])

  const onSave = useCallback(async () => {
    try {
      const handle = await saveWithFileSystemAccess(
        handleRef.current,
        source,
        layout,
        filename,
      )
      if (handle) handleRef.current = handle
      markClean()
    } catch (err) {
      console.error('save failed', err)
      alert(`Failed to save: ${(err as Error).message}`)
    }
  }, [source, layout, filename, markClean])

  const onPng = useCallback(async () => {
    if (!routed) {
      alert('Nothing to export yet — fix parse errors first.')
      return
    }
    if (!getSvg()) {
      alert('Canvas is not ready.')
      return
    }
    try {
      await onExportPng()
    } catch (err) {
      console.error('export png failed', err)
      alert(`PNG export failed: ${(err as Error).message}`)
    }
  }, [routed, onExportPng, getSvg])

  const onHtml = useCallback(async () => {
    if (!routed) {
      alert('Nothing to export yet — fix parse errors first.')
      return
    }
    if (!getSvg()) {
      alert('Canvas is not ready.')
      return
    }
    try {
      await onExportHtml()
    } catch (err) {
      console.error('export html failed', err)
      alert(`HTML export failed: ${(err as Error).message}`)
    }
  }, [routed, onExportHtml, getSvg])

  const onUndo = useCallback(() => useTemporalStore.getState().undo(), [])
  const onRedo = useCallback(() => useTemporalStore.getState().redo(), [])

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={onOpen}>
          Open
        </button>
        <button type="button" onClick={onSave}>
          Save{dirty ? '*' : ''}
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={onPng}>
          Export PNG
        </button>
        <select
          value={exportScale}
          onChange={(e) => setExportScale(Number(e.target.value) as ExportScale)}
          aria-label="PNG export scale"
        >
          {SCALES.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button type="button" onClick={onHtml}>
          Export HTML
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo}>
          Redo
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={onFitView}>
          Fit
        </button>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-check">
          <input type="checkbox" checked={showGrid} onChange={toggleGrid} />
          Grid
        </label>
        <label className="toolbar-num">
          Size
          <input
            type="number"
            min={2}
            max={128}
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="toolbar-group toolbar-filename">
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          aria-label="filename"
        />
      </div>
    </div>
  )
}
