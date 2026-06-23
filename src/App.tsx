import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Toolbar } from '@/editor/Toolbar'
import { CodeMirrorPane, type CodeMirrorPaneHandle } from '@/editor/CodeMirrorPane'
import { Canvas } from '@/renderer/Canvas'
import {
  useDiagramStore,
  useTemporalStore,
} from '@/store/diagramStore'
import {
  openWithFileSystemAccess,
  saveWithFileSystemAccess,
} from '@/file/zip'
import { exportPng } from '@/export/png'
import type { LayoutSidecar } from '@/layout/types'

import fixtureSource from '../fixtures/system.arch.d2?raw'
import fixtureLayoutRaw from '../fixtures/system.arch.layout.json?raw'
import './App.css'

const fallbackLayout = (): LayoutSidecar => ({
  gridSize: 16,
  nodes: {},
  edges: {},
  areas: [],
})

const parseFixtureLayout = (raw: string): LayoutSidecar => {
  try {
    return JSON.parse(raw) as LayoutSidecar
  } catch (err) {
    console.warn('Failed to parse fixture layout', err)
    return fallbackLayout()
  }
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const App = () => {
  const source = useDiagramStore((s) => s.source)
  const parseResult = useDiagramStore((s) => s.parseResult)
  const layout = useDiagramStore((s) => s.layout)

  const setSource = useDiagramStore((s) => s.setSource)
  const reparse = useDiagramStore((s) => s.reparse)
  const reroute = useDiagramStore((s) => s.reroute)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const markClean = useDiagramStore((s) => s.markClean)

  const editorRef = useRef<CodeMirrorPaneHandle | null>(null)
  const handleRef = useRef<FileSystemFileHandle | undefined>(undefined)

  // Bootstrap fixture on mount.
  useEffect(() => {
    const fixtureLayout = parseFixtureLayout(fixtureLayoutRaw)
    loadDocument(fixtureSource, fixtureLayout, 'system.arch')
  }, [loadDocument])

  // Reparse whenever the source changes.
  useEffect(() => {
    reparse()
  }, [source, reparse])

  // Reroute whenever a successful parse or layout lands.
  useEffect(() => {
    if (parseResult.ok) {
      void reroute()
    }
  }, [parseResult, layout, reroute])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()

      if (key === 's' && !e.shiftKey) {
        e.preventDefault()
        const { source: s, layout: l, filename: f } = useDiagramStore.getState()
        try {
          const handle = await saveWithFileSystemAccess(handleRef.current, s, l, f)
          if (handle) handleRef.current = handle
          markClean()
        } catch (err) {
          console.error('save failed', err)
        }
        return
      }

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useTemporalStore.getState().undo()
        return
      }

      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        useTemporalStore.getState().redo()
        return
      }

      if (key === 'e') {
        e.preventDefault()
        const current = useDiagramStore.getState()
        if (!current.routed) return
        try {
          const blob = await exportPng(current.routed, current.exportScale)
          downloadBlob(blob, `${current.filename}.png`)
        } catch (err) {
          console.error('export png failed', err)
        }
        return
      }

      if (key === 'o') {
        e.preventDefault()
        try {
          const doc = await openWithFileSystemAccess()
          if (!doc) return
          handleRef.current = doc.handle
          loadDocument(doc.source, doc.layout, doc.filename)
        } catch (err) {
          console.error('open failed', err)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loadDocument, markClean])

  const parseErrors = parseResult.ok ? [] : parseResult.errors

  return (
    <div className="app-root">
      <Toolbar />
      <div className="app-body">
        <PanelGroup direction="horizontal" autoSaveId="archgrid:panels">
          <Panel defaultSize={40} minSize={20} className="pane pane-editor">
            <CodeMirrorPane
              ref={editorRef}
              value={source}
              onChange={setSource}
              errors={parseErrors}
            />
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={60} minSize={30} className="pane pane-canvas">
            <Canvas />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}

export default App
