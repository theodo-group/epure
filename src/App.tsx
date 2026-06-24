import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { json as jsonLang } from '@codemirror/lang-json'
import { Header } from '@/editor/Header'
import { Footer } from '@/editor/Footer'
import { EditorTabBar } from '@/editor/EditorTabBar'
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
  const filename = useDiagramStore((s) => s.filename)
  const dirty = useDiagramStore((s) => s.dirty)
  const selectedNodeIds = useDiagramStore((s) => s.selectedNodeIds)
  const selectedAreaIds = useDiagramStore((s) => s.selectedAreaIds)

  const setSource = useDiagramStore((s) => s.setSource)
  const reparse = useDiagramStore((s) => s.reparse)
  const reroute = useDiagramStore((s) => s.reroute)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const markClean = useDiagramStore((s) => s.markClean)
  const toggleGrid = useDiagramStore((s) => s.toggleGrid)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectArea = useDiagramStore((s) => s.selectArea)
  const setSelection = useDiagramStore((s) => s.setSelection)
  const moveNode = useDiagramStore((s) => s.moveNode)
  const moveNodes = useDiagramStore((s) => s.moveNodes)
  const resizeNode = useDiagramStore((s) => s.resizeNode)
  const areaDragStartRef = useRef<Record<string, { cx: number; cy: number }>>({})
  const [fitVersion, setFitVersion] = useState(0)
  const [activeTab, setActiveTab] = useState<'d2' | 'layout'>('d2')
  const setLayout = useDiagramStore((s) => s.setLayout)
  const layoutJsonText = useMemo(
    () => JSON.stringify(layout, null, 2),
    [layout],
  )
  const multiDragRef = useRef<{
    leaderId: string
    leaderStart: { cx: number; cy: number }
    members: Record<string, { cx: number; cy: number }>
  } | null>(null)

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

  const onExportPng = async () => {
    const svg = svgRef.current
    if (!svg) return
    const { exportScale, filename: f } = useDiagramStore.getState()
    const blob = await exportPng(svg, exportScale)
    downloadBlob(blob, `${f}.png`)
  }

  const onExportHtml = async () => {
    const svg = svgRef.current
    if (!svg) return
    const { filename: f } = useDiagramStore.getState()
    const html = await exportStandaloneHtml(svg, { title: f })
    downloadBlob(new Blob([html], { type: 'text/html' }), `${f}.html`)
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
      <Header
        onExportPng={onExportPng}
        onExportHtml={onExportHtml}
        saveHandleRef={handleRef}
      />
      <div className="app-body">
        <PanelGroup direction="horizontal" autoSaveId="archgrid:panels">
          <Panel defaultSize={36} minSize={20} className="pane pane-editor">
            <EditorTabBar
              tabs={[
                { id: 'd2', label: `${filename}.d2`, dirty },
                { id: 'layout', label: `${filename}.layout.json` },
              ]}
              activeTabId={activeTab}
              onSelectTab={(id) => setActiveTab(id as 'd2' | 'layout')}
            />
            <div className="ag-cm-wrap">
              {activeTab === 'd2' ? (
                <CodeMirrorPane
                  key="d2"
                  ref={editorRef}
                  value={source}
                  onChange={setSource}
                  errors={parseResult.ok ? [] : parseResult.errors}
                />
              ) : (
                <CodeMirrorPane
                  key="layout"
                  value={layoutJsonText}
                  onChange={(text) => {
                    try {
                      const parsed = JSON.parse(text)
                      setLayout(parsed)
                    } catch {
                      // ignore invalid JSON; the user is mid-edit
                    }
                  }}
                  language={jsonLang()}
                />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={64} minSize={30} className="pane pane-canvas">
            <Canvas
              ref={svgRef}
              diagram={renderDiagram}
              showGrid={showGrid}
              onToggleGrid={toggleGrid}
              selectedNodeIds={selectedNodeIds}
              selectedAreaIds={selectedAreaIds}
              onSelectArea={(id, additive) => selectArea(id, additive)}
              onSelectNode={(id, additive) => {
                if (!id) {
                  if (!additive) selectNode(undefined)
                  return
                }
                if (additive) {
                  selectNode(id, true)
                } else if (!selectedNodeIds.includes(id)) {
                  selectNode(id, false)
                }
              }}
              onMoveNode={(id, cx, cy) => {
                const sel = useDiagramStore.getState().selectedNodeIds
                if (sel.length <= 1 || !sel.includes(id)) {
                  multiDragRef.current = null
                  moveNode(id, cx, cy)
                  return
                }
                const grid = useDiagramStore.getState().layout.gridSize
                const nodes = useDiagramStore.getState().layout.nodes
                let drag = multiDragRef.current
                if (!drag || drag.leaderId !== id) {
                  const leader = nodes[id]
                  if (!leader) return
                  const members: Record<string, { cx: number; cy: number }> = {}
                  for (const sid of sel) {
                    const n = nodes[sid]
                    if (n) members[sid] = { cx: n.cx, cy: n.cy }
                  }
                  drag = {
                    leaderId: id,
                    leaderStart: { cx: leader.cx, cy: leader.cy },
                    members,
                  }
                  multiDragRef.current = drag
                }
                const newLeaderCx = Math.round(cx / grid)
                const newLeaderCy = Math.round(cy / grid)
                const dgx = newLeaderCx - drag.leaderStart.cx
                const dgy = newLeaderCy - drag.leaderStart.cy
                const moves: Record<string, { cx: number; cy: number }> = {}
                for (const [sid, start] of Object.entries(drag.members)) {
                  moves[sid] = { cx: start.cx + dgx, cy: start.cy + dgy }
                }
                moveNodes(moves)
              }}
              onResizeNode={(id, side, x, y) => resizeNode(id, side, x, y)}
              onMarqueeSelect={(nodeIds, areaIds, additive) => {
                if (additive) {
                  const st = useDiagramStore.getState()
                  setSelection(
                    [...st.selectedNodeIds, ...nodeIds],
                    [...st.selectedAreaIds, ...areaIds],
                  )
                } else {
                  setSelection(nodeIds, areaIds)
                }
              }}
              onAreaDragStart={(areaId) => {
                if (!parseResult.ok) return
                const area = parseResult.diagram.areas.find((a) => a.id === areaId)
                if (!area) return
                const starts: Record<string, { cx: number; cy: number }> = {}
                for (const memberId of area.members) {
                  const ln = useDiagramStore.getState().layout.nodes[memberId]
                  if (ln) starts[memberId] = { cx: ln.cx, cy: ln.cy }
                }
                areaDragStartRef.current = starts
              }}
              onAreaDragMove={(_areaId, dx, dy) => {
                const { gridSize } = useDiagramStore.getState().layout
                const dgx = Math.round(dx / gridSize)
                const dgy = Math.round(dy / gridSize)
                const moves: Record<string, { cx: number; cy: number }> = {}
                for (const [id, start] of Object.entries(areaDragStartRef.current)) {
                  moves[id] = { cx: start.cx + dgx, cy: start.cy + dgy }
                }
                moveNodes(moves)
              }}
              fitVersion={fitVersion}
              onFitView={() => setFitVersion((v) => v + 1)}
              nodes={nodesMeta}
              edges={edgesMeta}
            />
          </Panel>
        </PanelGroup>
      </div>
      <Footer />
    </div>
  )
}

export default App
