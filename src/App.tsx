import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { json as jsonLang } from '@codemirror/lang-json'
import { Header } from '@/editor/Header'
import { Footer } from '@/editor/Footer'
import { EditorTabBar } from '@/editor/EditorTabBar'
import { CodeMirrorPane, type CodeMirrorPaneHandle } from '@/editor/CodeMirrorPane'
import { useLayoutEditorBuffer } from '@/editor/useLayoutEditorBuffer'
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
import { locateLayoutKeyRanges } from '@/file/layoutSchema'
import { exportPng } from '@/export/png'
import { exportStandaloneHtml } from '@/export/standalone-html'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'
import { useBridge } from '@/bridge/useBridge'
import { ClashDialog } from '@/bridge/ClashDialog'
import { readInjectedBridge } from '@/bridge/config'
import { interaction } from '@/bridge/interaction'
import { useFeedback } from '@/feedback/useFeedback'
import { FeedbackToolbar } from '@/feedback/FeedbackToolbar'

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
  const loadDocumentBase = useDiagramStore((s) => s.loadDocument)
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
  const setEdgeLabelOffset = useDiagramStore((s) => s.setEdgeLabelOffset)
  const resizeNode = useDiagramStore((s) => s.resizeNode)
  const areaDragStartRef = useRef<Record<string, { cx: number; cy: number }>>({})
  const [fitVersion, setFitVersion] = useState(0)
  const [activeTab, setActiveTab] = useState<'d2' | 'layout'>('d2')
  const setLayout = useDiagramStore((s) => s.setLayout)
  // The layout JSON editor's buffer is a second representation of `layout`; this
  // hook keeps the two in sync without letting a store-side change (a node drag,
  // a remote write) clobber an in-progress invalid edit.
  const {
    text: layoutText,
    errors: layoutErrors,
    edit: editLayout,
    reset: resetLayoutBuffer,
  } = useLayoutEditorBuffer(layout, setLayout)

  // Loading a whole new document is the one case where discarding the editor
  // buffer is correct — clear the dirty latch so the freshly loaded layout
  // re-baselines the editor instead of being held back by stale unsaved text.
  const loadDocument = useCallback(
    (nextSource: string, nextLayout: LayoutSidecar) => {
      resetLayoutBuffer()
      loadDocumentBase(nextSource, nextLayout)
    },
    [loadDocumentBase, resetLayoutBuffer],
  )
  const multiDragRef = useRef<{
    leaderId: string
    leaderStart: { cx: number; cy: number }
    members: Record<string, { cx: number; cy: number }>
  } | null>(null)

  const editorRef = useRef<CodeMirrorPaneHandle | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // The live bridge (when present) hydrates the store from disk over WebSocket;
  // returns presentational status for the footer pill.
  const bridge = useBridge()

  // Live feedback (impeccable-style): the toolbar's pick/insert/text submissions
  // ride the bridge socket to the server queue; the host Claude Code drains them
  // over `epure poll`. Ephemeral — nothing is written to disk.
  const feedback = useFeedback(bridge)

  // Hydrate from localStorage on mount, falling back to the bundled fixture.
  // In bridge mode the WS hydrate is authoritative — skip localStorage entirely
  // so a different repo's stale doc can't flash in or win the race. We read the
  // injected global synchronously (detectBridge's async probe is for the
  // connection, not the bootstrap decision).
  useEffect(() => {
    if (readInjectedBridge()) return
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

  // Mirror the canvas selection into whichever editor tab is active as range
  // highlights, so the user can see which declaration defines the selected
  // element(s). On the d2 tab we use the AST source ranges; on the layout JSON
  // tab we locate the matching keys in the sidecar (nodes/edges/areas). Edge ids
  // encode the AST index after `#` — the d2 ranges are per-edge, while the
  // layout keys the style by `source->target` (shared across parallel edges).
  useEffect(() => {
    const handle = editorRef.current
    if (!handle) return

    if (activeTab === 'layout') {
      // Strip the `#index` ordinal so selected siblings collapse onto their
      // shared style key. Areas/nodes match their layout keys directly.
      const edgeKeys = selectedEdgeIds.map((id) => id.split('#')[0]!)
      handle.highlightRanges(
        locateLayoutKeyRanges(layoutText, {
          nodes: selectedNodeIds,
          edges: edgeKeys,
          areas: selectedAreaIds,
        }),
      )
      return
    }

    if (!parseResult.ok) {
      handle.highlightRanges([])
      return
    }
    const ranges: { from: number; to: number }[] = []
    const nodeById = new Map(parseResult.diagram.nodes.map((n) => [n.id, n]))
    for (const id of selectedNodeIds) {
      const n = nodeById.get(id)
      if (n) ranges.push({ from: n.range.start.offset, to: n.range.end.offset })
    }
    const areaById = new Map(parseResult.diagram.areas.map((a) => [a.id, a]))
    for (const id of selectedAreaIds) {
      const a = areaById.get(id)
      if (a) ranges.push({ from: a.range.start.offset, to: a.range.end.offset })
    }
    for (const id of selectedEdgeIds) {
      const hashIdx = id.lastIndexOf('#')
      if (hashIdx < 0) continue
      const i = Number(id.slice(hashIdx + 1))
      const e = parseResult.diagram.edges[i]
      if (e) ranges.push({ from: e.range.start.offset, to: e.range.end.offset })
    }
    handle.highlightRanges(ranges)
  }, [
    selectedNodeIds,
    selectedAreaIds,
    selectedEdgeIds,
    parseResult,
    activeTab,
    layoutText,
  ])

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
                  onChange={(text) => {
                    // Mark local activity so the bridge defers inbound applies
                    // while the user is typing (the d2 buffer is bound directly
                    // to the store, so a remote write would replace it live).
                    interaction.noteActivity()
                    setSource(text)
                  }}
                  errors={parseResult.ok ? [] : parseResult.errors}
                />
              ) : (
                <CodeMirrorPane
                  key="layout"
                  ref={editorRef}
                  value={layoutText}
                  onChange={(text) => {
                    // Mark activity on EVERY keystroke — invalid JSON never
                    // reaches the store, so without this the bridge wouldn't see
                    // the user as busy and a remote layout write could clobber
                    // the in-progress (invalid) buffer.
                    interaction.noteActivity()
                    editLayout(text)
                  }}
                  errors={layoutErrors}
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
              onMoveLabel={(id, dx, dy) => setEdgeLabelOffset(id, dx, dy)}
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
              feedbackMode={feedback.mode}
              feedbackTarget={feedback.target}
              onPick={feedback.pick}
              onInsertPoint={feedback.insertPoint}
            />
            <StylePanel />
            {bridge.active ? <FeedbackToolbar fb={feedback} /> : null}
          </Panel>
        </PanelGroup>
      </div>
      <Footer bridge={bridge} />
      {bridge.clash ? (
        <ClashDialog clash={bridge.clash} onResolve={bridge.resolveClash} />
      ) : null}
    </div>
  )
}

export default App
