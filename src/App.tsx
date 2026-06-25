import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { json as jsonLang } from '@codemirror/lang-json'
import { Header } from '@/editor/Header'
import { Footer } from '@/editor/Footer'
import { EditorTabBar } from '@/editor/EditorTabBar'
import { CodeMirrorPane, type CodeMirrorPaneHandle } from '@/editor/CodeMirrorPane'
import { Canvas, type EdgeMeta, type NodeMeta } from '@/renderer/Canvas'
import { StylePanel } from '@/style/StylePanel'
import {
  FONT_LABELS,
  FONT_STACKS,
  useDiagramStore,
  useTemporalStore,
  type FontFamilyId,
} from '@/store/diagramStore'
import { openWithFileSystemAccess } from '@/file/zip'
import {
  clearStoredHistory,
  loadStoredDoc,
  loadStoredHistory,
  saveStoredDoc,
  saveStoredHistory,
  type StoredDoc,
} from '@/file/localStore'
import { validateLayoutJson } from '@/file/layoutSchema'
import { exportPng } from '@/export/png'
import { exportStandaloneHtml } from '@/export/standalone-html'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'

import fixtureSource from '../fixtures/system.epr.d2?raw'
import fixtureLayoutRaw from '../fixtures/system.epr.layout.json?raw'
import './App.css'

const EXPORT_STEM = 'diagram'
const PERSIST_DEBOUNCE_MS = 250

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
  const textScale = useDiagramStore((s) => s.textScale)
  const fontFamily = useDiagramStore((s) => s.fontFamily)
  const selectedNodeIds = useDiagramStore((s) => s.selectedNodeIds)
  const selectedAreaIds = useDiagramStore((s) => s.selectedAreaIds)
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds)

  const setSource = useDiagramStore((s) => s.setSource)
  const reparse = useDiagramStore((s) => s.reparse)
  const reroute = useDiagramStore((s) => s.reroute)
  const loadDocument = useDiagramStore((s) => s.loadDocument)
  const toggleGrid = useDiagramStore((s) => s.toggleGrid)
  const setTextScale = useDiagramStore((s) => s.setTextScale)
  const setFontFamily = useDiagramStore((s) => s.setFontFamily)
  const fontOptions = useMemo(
    () =>
      (Object.keys(FONT_STACKS) as FontFamilyId[]).map((id) => ({
        id,
        label: FONT_LABELS[id],
        stack: FONT_STACKS[id],
      })),
    [],
  )
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectArea = useDiagramStore((s) => s.selectArea)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
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
  // Mirror the JSON editor's current text in App state so schema validation
  // runs against in-progress edits, not the last successfully-applied layout.
  const [layoutText, setLayoutText] = useState(layoutJsonText)
  const layoutTextRef = useRef(layoutText)
  useEffect(() => {
    layoutTextRef.current = layoutText
  }, [layoutText])
  // Resync only when the store layout actually changes (e.g. a node drag), and
  // only when the editor's text doesn't already represent that layout — keying
  // the effect on `layoutJsonText` keeps schema-invalid edits intact (those
  // never reach the store, so the formatted text never changes).
  useEffect(() => {
    try {
      const current = JSON.parse(layoutTextRef.current)
      if (JSON.stringify(current) === JSON.stringify(layout)) return
    } catch {
      // text is mid-edit and unparseable — fall through to force-sync.
    }
    setLayoutText(layoutJsonText)
  }, [layoutJsonText, layout])
  const layoutValidation = useMemo(
    () => validateLayoutJson(layoutText),
    [layoutText],
  )
  const multiDragRef = useRef<{
    leaderId: string
    leaderStart: { cx: number; cy: number }
    members: Record<string, { cx: number; cy: number }>
  } | null>(null)

  const editorRef = useRef<CodeMirrorPaneHandle | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Hydrate from localStorage on mount, falling back to the bundled fixture.
  useEffect(() => {
    const stored = loadStoredDoc()
    if (stored) {
      loadDocument(stored.source, stored.layout)
      // loadDocument clears the undo history; restore the persisted past/future
      // stacks on top of the just-loaded baseline so undo/redo survives reload.
      const history = loadStoredHistory()
      if (history) {
        useTemporalStore.setState({
          pastStates: history.past,
          futureStates: history.future,
        })
      }
    } else {
      loadDocument(fixtureSource, parseFixtureLayout(fixtureLayoutRaw))
      // No stored doc → any persisted history belongs to a different document.
      clearStoredHistory()
    }
  }, [loadDocument])

  // Persist source + layout + the undo/redo stacks to localStorage (debounced).
  // Both are saved together so the restored history stays consistent with the
  // restored document.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveStoredDoc({ source, layout })
      const temporal = useTemporalStore.getState()
      saveStoredHistory({
        past: temporal.pastStates as StoredDoc[],
        future: temporal.futureStates as StoredDoc[],
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [source, layout])

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
    const { exportScale } = useDiagramStore.getState()
    const blob = await exportPng(svg, exportScale)
    downloadBlob(blob, `${EXPORT_STEM}.png`)
  }

  const onExportHtml = async () => {
    const svg = svgRef.current
    if (!svg) return
    const html = await exportStandaloneHtml(svg, { title: EXPORT_STEM })
    downloadBlob(new Blob([html], { type: 'text/html' }), `${EXPORT_STEM}.html`)
  }

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = async (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      const key = ev.key.toLowerCase()

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
          loadDocument(doc.source, doc.layout)
        } catch (err) {
          console.error('open failed', err)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loadDocument])

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
      <Header onExportPng={onExportPng} onExportHtml={onExportHtml} />
      <div className="app-body">
        <PanelGroup direction="horizontal" autoSaveId="epure:panels">
          <Panel defaultSize={36} minSize={20} className="pane pane-editor">
            <EditorTabBar
              tabs={[
                { id: 'd2', label: 'diagram.d2' },
                { id: 'layout', label: 'diagram.layout.json' },
              ]}
              activeTabId={activeTab}
              onSelectTab={(id) => setActiveTab(id as 'd2' | 'layout')}
              onSearch={() => editorRef.current?.openSearch()}
            />
            <div className="ep-cm-wrap">
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
                  ref={editorRef}
                  value={layoutText}
                  onChange={(text) => {
                    setLayoutText(text)
                    const result = validateLayoutJson(text)
                    if (result.value) setLayout(result.value)
                  }}
                  errors={layoutValidation.errors}
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
              textScale={textScale}
              onSetTextScale={setTextScale}
              fontFamily={FONT_STACKS[fontFamily]}
              fontOptions={fontOptions}
              selectedFontId={fontFamily}
              onSetFontFamily={(id) => setFontFamily(id as FontFamilyId)}
              selectedNodeIds={selectedNodeIds}
              selectedAreaIds={selectedAreaIds}
              selectedEdgeIds={selectedEdgeIds}
              onSelectArea={(id, additive) => selectArea(id, additive)}
              onSelectEdge={(id, additive) => selectEdge(id, additive)}
              onSelectNode={(id, additive) => {
                if (!id) {
                  if (!additive) selectNode(undefined)
                  return
                }
                if (additive) {
                  selectNode(id, true)
                } else if (!selectedNodeIds.includes(id)) {
                  selectNode(id, false)
                } else if (selectedAreaIds.length > 0 || selectedEdgeIds.length > 0) {
                  // Already-selected node: keep the (possibly multi-) node
                  // selection for dragging, but drop stale cross-kind selection.
                  setSelection(selectedNodeIds, [], [])
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
                    st.selectedEdgeIds,
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
            <StylePanel />
          </Panel>
        </PanelGroup>
      </div>
      <Footer />
    </div>
  )
}

export default App
