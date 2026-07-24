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
  mintNodeId,
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
import { editorHtmlToLabel, labelToEditorHtml, quoteD2 } from '@/editor/labelMarkup'
import { exportPng, type ExportFrame } from '@/export/png'
import { embedSourceInPngBlob } from '@/export/pngText'
import { exportStandaloneHtml } from '@/export/standalone-html'
import { layoutToText } from '@/bridge/sync'
import { computeContentBounds } from '@/renderer/bounds'
import type { LayoutSidecar, RoutedDiagram } from '@/layout/types'
import { buildAreaTree } from '@/layout/areaTree'
import { normalizeForRoute } from '@/layout/normalize'
import { useBridge } from '@/bridge/useBridge'
import { ClashDialog } from '@/bridge/ClashDialog'
import { readInjectedBridge } from '@/bridge/config'
import { interaction } from '@/bridge/interaction'

import fixtureSource from '../fixtures/system.epr.d2?raw'
import fixtureLayoutRaw from '../fixtures/system.epr.layout.json?raw'
import './App.css'

// Stem of the bundled fixture (`fixtures/system.epr.*`); the default doc name
// until a file is opened or a live bridge supplies the real one.
const DEFAULT_DOC_NAME = 'system'
// Content-space margin around the diagram in the fitted PNG/HTML export.
const EXPORT_PADDING = 48
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

// Append one or more statements to the .d2 source on their own lines, keeping a
// single separating newline so the diff is exactly the lines added (the parser
// collapses consecutive newlines, so a trailing one is harmless).
const appendBlock = (src: string, lines: string[]): string => {
  const body = lines.join('\n')
  if (src.length === 0) return `${body}\n`
  const sep = src.endsWith('\n') ? '' : '\n'
  return `${src}${sep}${body}\n`
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
  const deleteSelection = useDiagramStore((s) => s.deleteSelection)
  const moveNode = useDiagramStore((s) => s.moveNode)
  const moveNodes = useDiagramStore((s) => s.moveNodes)
  const setEdgeLabelOffset = useDiagramStore((s) => s.setEdgeLabelOffset)
  const resizeNode = useDiagramStore((s) => s.resizeNode)
  const areaDragStartRef = useRef<
    Record<string, { cx: number; cy: number; w: number; h: number }>
  >({})
  const [fitVersion, setFitVersion] = useState(0)
  const [openedName, setOpenedName] = useState(DEFAULT_DOC_NAME)
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

  // Open a document from disk and remember its filename stem (shown in the UI
  // and used for export). Lifted here from the Header so both the Open button
  // and the ⌘O shortcut go through one path that captures the name.
  const handleOpen = useCallback(async () => {
    try {
      const doc = await openWithFileSystemAccess()
      if (!doc) return
      loadDocument(doc.source, doc.layout)
      setOpenedName(doc.filename)
    } catch (err) {
      console.error('open failed', err)
    }
  }, [loadDocument])
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

  // The diagram's filename stem, shown in the editor tabs / window title and
  // used for the export filename. A live bridge knows the real on-disk name
  // (authoritative when connected); otherwise it's whatever file was opened, or
  // the bundled fixture's stem. Falls back to the default so a pathological
  // opened name (e.g. a bare `.epr.zip` → empty stem) never yields `.png` /
  // `.d2` with no base.
  const docName =
    (bridge.active && bridge.filename ? bridge.filename : openedName) ||
    DEFAULT_DOC_NAME

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
      if (stored.name) setOpenedName(stored.name)
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
      saveStoredDoc({ source, layout, name: openedName })
      const temporal = useTemporalStore.getState()
      saveStoredHistory({
        past: temporal.pastStates as StoredDoc[],
        future: temporal.futureStates as StoredDoc[],
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [source, layout, openedName])

  // Reflect the document name in the window/tab title.
  useEffect(() => {
    document.title = docName ? `${docName} — Épure` : 'Épure'
  }, [docName])

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

  // Export a PNG framed to the diagram's content bounds (a fitted view of the
  // whole diagram), not the editor's current pan/zoom.
  const onExportPng = useCallback(async () => {
    const svg = svgRef.current
    if (!svg) return
    const { exportScale, source, layout } = useDiagramStore.getState()
    let frame: ExportFrame | undefined
    if (routed) {
      const b = computeContentBounds(routed, edgesMeta, textScale)
      frame = {
        x: b.x - EXPORT_PADDING,
        y: b.y - EXPORT_PADDING,
        w: Math.max(1, b.w + EXPORT_PADDING * 2),
        h: Math.max(1, b.h + EXPORT_PADDING * 2),
      }
    }
    const blob = await exportPng(svg, exportScale, frame)
    // Embed the diagram's own source so the exported image round-trips back to
    // the editable pair (matches the headless `epure export`; recover with
    // `epure source <file.png>`).
    const withSource = await embedSourceInPngBlob(blob, source, layoutToText(layout))
    downloadBlob(withSource, `${docName}.png`)
  }, [routed, edgesMeta, textScale, docName])

  const onExportHtml = useCallback(async () => {
    const svg = svgRef.current
    if (!svg) return
    const html = await exportStandaloneHtml(svg, { title: docName })
    downloadBlob(new Blob([html], { type: 'text/html' }), `${docName}.html`)
  }, [docName])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = async (ev: KeyboardEvent) => {
      // Don't hijack ⌘Z/⌘Y/⌘E/⌘O while the user is typing in the inline label
      // editor — the contentEditable handles its own editing keys (native undo,
      // bold/italic, commit). Without this, ⌘Z would undo the whole diagram.
      const target = ev.target
      if (target instanceof HTMLElement && target.closest('.ep-label-editable')) {
        return
      }
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
        await handleOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpen, onExportPng])

  // Commit an inline label edit from the canvas: rewrite the node's label in
  // the .d2 source in place (or insert one after the id when the node has none).
  // Read source/parse from the store so the closure never goes stale between
  // edits. Routes through `setSource`, so it reparses/reroutes/persists and
  // syncs to disk exactly like a keystroke in the code editor.
  const handleCommitNodeLabel = useCallback(
    (id: string, markup: string) => {
      const { source: src, parseResult: parsed } = useDiagramStore.getState()
      if (!parsed.ok) return
      const node = parsed.diagram.nodes.find((n) => n.id === id)
      if (!node) return
      // Skip the write when the edit is a no-op against the *canonical* form of
      // the stored label — the source may use <strong>/<em>, real newlines, or
      // stray whitespace, and merely opening then dismissing the editor (or a
      // genuine no-change commit) must not rewrite the .d2 into canonical form.
      const probe = document.createElement('div')
      probe.innerHTML = labelToEditorHtml(node.label ?? '')
      if (markup === editorHtmlToLabel(probe)) return
      let next: string
      if (node.labelRange) {
        next =
          src.slice(0, node.labelRange.start.offset) +
          quoteD2(markup) +
          src.slice(node.labelRange.end.offset)
      } else {
        // No label declared yet; nothing to write if it's still empty.
        if (markup === '') return
        const at = node.idRange.end.offset
        next = `${src.slice(0, at)}: ${quoteD2(markup)}${src.slice(at)}`
      }
      interaction.noteActivity()
      setSource(next)
    },
    [setSource],
  )

  // Create a node from the canvas (N): mint a stable machine id, append a bare
  // declaration to the .d2, and select it. Returns the new id so the canvas can
  // open its inline label editor once the node lands (creation is async — it
  // routes through setSource → reparse → reroute like any other edit, so the
  // node doesn't exist yet when this returns). No layout.json is written: an
  // unpositioned node is auto-placed by the router, keeping the diff to +1 line.
  const handleCreateNode = useCallback((): string | null => {
    const { source: src, parseResult: parsed } = useDiagramStore.getState()
    if (!parsed.ok) return null
    const id = mintNodeId(parsed.diagram)
    interaction.noteActivity()
    setSource(appendBlock(src, [id]))
    selectNode(id, false)
    return id
  }, [setSource, selectNode])

  // Connect the current node selection into a chain (C): append `a -> b`,
  // `b -> c`… for the selected nodes in selection order (Shift+C reverses each
  // arrow). Skips self-loops and any edge that already exists, and only wires
  // real nodes (areas in the selection are ignored). Plain edges need no layout
  // sidecar entry — the router picks the faces — so the diff is just the lines.
  const handleConnectSelection = useCallback(
    (reverse: boolean) => {
      const {
        source: src,
        parseResult: parsed,
        selectedNodeIds: sel,
      } = useDiagramStore.getState()
      if (!parsed.ok || sel.length < 2) return
      const nodeIds = new Set(parsed.diagram.nodes.map((n) => n.id))
      const seen = new Set(
        parsed.diagram.edges.map((e) => `${e.source}->${e.target}`),
      )
      const lines: string[] = []
      for (let i = 0; i < sel.length - 1; i += 1) {
        const a = sel[i]!
        const b = sel[i + 1]!
        const from = reverse ? b : a
        const to = reverse ? a : b
        if (from === to) continue
        if (!nodeIds.has(from) || !nodeIds.has(to)) continue
        const key = `${from}->${to}`
        if (seen.has(key)) continue
        seen.add(key)
        lines.push(`${from} -> ${to}`)
      }
      if (lines.length === 0) return
      interaction.noteActivity()
      setSource(appendBlock(src, lines))
    },
    [setSource],
  )

  // Delete the current selection (Delete/Backspace). Routes through the store so
  // the source + layout edit is a single undoable step; noteActivity keeps the
  // bridge from clobbering it with an inbound apply mid-edit.
  const handleDeleteSelection = useCallback(() => {
    const st = useDiagramStore.getState()
    if (
      st.selectedNodeIds.length === 0 &&
      st.selectedAreaIds.length === 0 &&
      st.selectedEdgeIds.length === 0
    )
      return
    interaction.noteActivity()
    deleteSelection()
  }, [deleteSelection])

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
        onOpen={handleOpen}
        onExportPng={onExportPng}
        onExportHtml={onExportHtml}
      />
      <div className="app-body">
        <PanelGroup direction="horizontal" autoSaveId="epure:panels">
          <Panel defaultSize={36} minSize={20} className="pane pane-editor">
            <EditorTabBar
              tabs={[
                { id: 'd2', label: `${docName}.d2` },
                { id: 'layout', label: `${docName}.layout.json` },
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
              onCommitNodeLabel={handleCommitNodeLabel}
              onCreateNode={handleCreateNode}
              onConnectSelection={handleConnectSelection}
              onDeleteSelection={handleDeleteSelection}
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
                const { diagram } = parseResult
                if (!diagram.areas.some((a) => a.id === areaId)) return
                // Seed from the normalized layout, not the raw sidecar, so a
                // freshly-typed group whose members are still auto-placed (no
                // sidecar entry yet) drags too — normalizeForRoute gives every
                // member the exact grid position + size it's drawn at.
                // Membership is resolved TRANSITIVELY: dragging a container
                // carries the nodes of its nested member areas, whose derived
                // boxes then follow along.
                const { layout } = useDiagramStore.getState()
                const norm = normalizeForRoute(diagram, layout)
                const memberIds =
                  buildAreaTree(diagram.areas).leafNodesOf.get(areaId) ?? new Set<string>()
                const starts: Record<
                  string,
                  { cx: number; cy: number; w: number; h: number }
                > = {}
                for (const memberId of memberIds) {
                  const n = norm.nodes[memberId]
                  if (n) starts[memberId] = { cx: n.cx, cy: n.cy, w: n.w, h: n.h }
                }
                areaDragStartRef.current = starts
              }}
              onAreaDragMove={(_areaId, dx, dy) => {
                const { gridSize } = useDiagramStore.getState().layout
                const dgx = Math.round(dx / gridSize)
                const dgy = Math.round(dy / gridSize)
                const moves: Record<
                  string,
                  { cx: number; cy: number; w: number; h: number }
                > = {}
                for (const [id, start] of Object.entries(areaDragStartRef.current)) {
                  moves[id] = { cx: start.cx + dgx, cy: start.cy + dgy, w: start.w, h: start.h }
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
      <Footer bridge={bridge} />
      {bridge.clash ? (
        <ClashDialog clash={bridge.clash} onResolve={bridge.resolveClash} />
      ) : null}
    </div>
  )
}

export default App
