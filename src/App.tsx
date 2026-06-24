import { useEffect, useMemo, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Toolbar } from '@/editor/Toolbar'
import { CodeMirrorPane, type CodeMirrorPaneHandle } from '@/editor/CodeMirrorPane'
import { Canvas, type EdgeMeta, type NodeMeta } from '@/renderer/Canvas'
import {
  useDiagramStore,
  useTemporalStore,
} from '@/store/diagramStore'
import {
  openWithFileSystemAccess,
  saveWithFileSystemAccess,
} from '@/file/zip'
import { exportPng } from '@/export/png'
import { exportStandaloneHtml } from '@/export/standalone-html'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'

import fixtureSource from '../fixtures/system.arch.d2?raw'
import fixtureLayoutRaw from '../fixtures/system.arch.layout.json?raw'
import './App.css'

const fallbackLayout = (): LayoutSidecar => ({
  gridSize: 40,
  nodes: {},
  edges: {},
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
  const routed = useDiagramStore((s) => s.routed)
  const showGrid = useDiagramStore((s) => s.showGrid)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)

  const setSource = useDiagramStore((s) => s.setSource)
  const reparse = useDiagramStore((s) => s.reparse)
  const reroute = useDiagramStore((s) => s.reroute)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const markClean = useDiagramStore((s) => s.markClean)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const moveNode = useDiagramStore((s) => s.moveNode)

  const editorRef = useRef<CodeMirrorPaneHandle | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
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

  const { nodesMeta, edgesMeta } = useMemo(() => {
    const n: Record<string, NodeMeta> = {}
    const e: Record<string, EdgeMeta> = {}
    if (parseResult.ok) {
      for (const node of parseResult.diagram.nodes) {
        n[node.id] = { shape: node.shape, label: node.label }
      }
      parseResult.diagram.edges.forEach((edge, i) => {
        const id = `${edge.source}->${edge.target}#${i}`
        e[id] = { label: edge.label, style: edge.style, marker: edge.direction }
      })
    }
    return { nodesMeta: n, edgesMeta: e }
  }, [parseResult])

  const getSvg = (): SVGSVGElement | null => svgRef.current

  const onExportPng = async () => {
    const svg = svgRef.current
    if (!svg) return
    const { exportScale, filename } = useDiagramStore.getState()
    const blob = await exportPng(svg, exportScale)
    downloadBlob(blob, `${filename}.png`)
  }

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = async (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      const key = ev.key.toLowerCase()

      if (key === 's' && !ev.shiftKey) {
        ev.preventDefault()
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

      if (key === 'z' && !ev.shiftKey) {
        ev.preventDefault()
        useTemporalStore.getState().undo()
        return
      }

      if ((key === 'z' && ev.shiftKey) || key === 'y') {
        ev.preventDefault()
        useTemporalStore.getState().redo()
        return
      }

      if (key === 'e') {
        ev.preventDefault()
        try {
          await onExportPng()
        } catch (err) {
          console.error('export png failed', err)
        }
        return
      }

      if (key === 'o') {
        ev.preventDefault()
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

  const placeholderDiagram: RoutedDiagram = useMemo(
    () => ({
      gridSize: layout.gridSize,
      nodes: [],
      areas: [],
      edges: [],
    }),
    [layout],
  )

  const renderDiagram = routed ?? placeholderDiagram

  return (
    <div className="app-root">
      <Toolbar
        onExportPng={async () => {
          try {
            await onExportPng()
          } catch (err) {
            console.error('export png failed', err)
          }
        }}
        onExportHtml={async () => {
          const svg = svgRef.current
          if (!svg) return
          const { filename } = useDiagramStore.getState()
          try {
            const html = await exportStandaloneHtml(svg, { title: filename })
            downloadBlob(
              new Blob([html], { type: 'text/html' }),
              `${filename}.html`,
            )
          } catch (err) {
            console.error('export html failed', err)
          }
        }}
        getSvg={getSvg}
      />
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
            <Canvas
              ref={svgRef}
              diagram={renderDiagram}
              showGrid={showGrid}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => selectNode(id || undefined)}
              onMoveNode={(id, cx, cy) => moveNode(id, cx, cy)}
              nodes={nodesMeta}
              edges={edgesMeta}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}

export default App
