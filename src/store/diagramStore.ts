import { create } from 'zustand'
import { temporal } from 'zundo'
import type { ParseResult } from '@/parser/ast'
import { parse } from '@/parser'
import type {
  AreaStyleSpec,
  EdgeStyleSpec,
  LayoutSidecar,
  NodeStyle,
  RoutedDiagram,
  Side,
} from '@/layout/types'
import { invalidateFaceCache, makeEdgeId, route } from '@/layout/elk'
import { normalizeForRoute } from '@/layout/normalize'

// A routed edge id is `source->target#index`; the style sidecar keys edges by
// `source->target` (shared across parallel edges), so strip the ordinal.
const edgeStyleKey = (edgeId: string) => edgeId.split('#')[0]!

export type ExportScale = 1 | 2 | 4

export type FontFamilyId =
  | 'inter'
  | 'poppins'
  | 'system'
  | 'helvetica'
  | 'georgia'
  | 'mono'

export const FONT_STACKS: Record<FontFamilyId, string> = {
  inter: 'Inter, system-ui, sans-serif',
  poppins: 'Poppins, system-ui, sans-serif',
  system: 'system-ui, -apple-system, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
}

export const FONT_LABELS: Record<FontFamilyId, string> = {
  inter: 'Inter',
  poppins: 'Poppins',
  system: 'System',
  helvetica: 'Helvetica',
  georgia: 'Georgia',
  mono: 'Mono',
}

export interface DiagramState {
  source: string
  layout: LayoutSidecar
  parseResult: ParseResult
  routed: RoutedDiagram | null
  selectedNodeIds: string[]
  selectedAreaIds: string[]
  selectedEdgeIds: string[]
  showGrid: boolean
  gridSize: number
  exportScale: ExportScale
  /** Global multiplier applied on top of per-element font sizes. */
  textScale: number
  /** Global font family used for all diagram text. */
  fontFamily: FontFamilyId
  /** Optional pixel position of the floating style panel. null = anchored
   *  to the default corner (top-right of the canvas pane). */
  stylePanelPosition: { left: number; top: number } | null
}

export interface DiagramActions {
  setSource: (source: string) => void
  setLayout: (layout: LayoutSidecar) => void
  moveNode: (id: string, x: number, y: number) => void
  moveNodes: (positions: Record<string, { cx: number; cy: number }>) => void
  resizeNode: (id: string, side: Side, pxX: number, pxY: number) => void
  setEdgeSide: (edgeKey: string, end: 'source' | 'target', side: Side) => void
  /** Nudge an edge's label off its routed anchor, in grid units. Pass a routed
   *  edge id (`src->tgt#i`) — the ordinal is stripped, so the offset is shared
   *  by every parallel edge of the pair. `(0, 0)` clears the override. */
  setEdgeLabelOffset: (edgeId: string, labelDx: number, labelDy: number) => void
  setNodeSize: (id: string, w: number, h: number) => void
  selectNode: (id: string | undefined, additive?: boolean) => void
  selectArea: (id: string | undefined, additive?: boolean) => void
  selectEdge: (id: string | undefined, additive?: boolean) => void
  setSelectedNodeIds: (ids: string[]) => void
  setSelectedAreaIds: (ids: string[]) => void
  setSelectedEdgeIds: (ids: string[]) => void
  setSelection: (nodeIds: string[], areaIds: string[], edgeIds?: string[]) => void
  clearSelection: () => void
  /** Merge a style patch into every selected node / edge / area. */
  setNodeStyle: (patch: Partial<NodeStyle>) => void
  /** Merge a patch into every selected edge's sidecar entry. Besides visual
   *  style it also accepts `sourceSide`/`targetSide` — pinning which node face an
   *  edge attaches to (the router honors a pinned side; `undefined` = auto). */
  setEdgeStyle: (patch: Partial<EdgeStyleSpec> & { sourceSide?: Side; targetSide?: Side }) => void
  setAreaStyle: (patch: Partial<AreaStyleSpec>) => void
  toggleGrid: () => void
  setGridSize: (n: number) => void
  setExportScale: (s: ExportScale) => void
  setTextScale: (s: number) => void
  setFontFamily: (f: FontFamilyId) => void
  setStylePanelPosition: (pos: { left: number; top: number } | null) => void
  reparse: () => void
  reroute: () => Promise<void>
  loadDocument: (source: string, layout: LayoutSidecar) => void
  /** Inbound bridge chokepoint: apply a remote (CC/disk) edit without creating
   *  an undo entry or clearing history. See `flushBurst`. */
  applyRemote: (patch: { source?: string; layout?: LayoutSidecar }) => void
}

export type DiagramStore = DiagramState & DiagramActions

const initialSource = ''
const initialLayout: LayoutSidecar = {
  gridSize: 40,
  nodes: {},
  edges: {},
}
const initialParse: ParseResult = { ok: false, errors: [] }

// Undo-burst coalescing state, hoisted out of `handleSet` so the bridge's
// remote-apply path can reset it. Without this reset, a local edit landing
// <350ms after a remote apply would fuse into the *pre-remote* undo step.
const burstState: {
  timeout: ReturnType<typeof setTimeout> | undefined
  active: boolean
} = { timeout: undefined, active: false }

/** Reset the in-flight undo-burst window so the next tracked change opens a
 *  fresh snapshot. Called by `applyRemote` after a bridge write. */
export const flushBurst = (): void => {
  if (burstState.timeout) clearTimeout(burstState.timeout)
  burstState.timeout = undefined
  burstState.active = false
}

// Reroute scheduling. `route()` is async (it awaits libavoid's WASM router) and
// a drag fires a layout change — hence a reroute — on every grid step. Two
// mechanisms keep that cheap and smooth:
//   1. Coalescing — only one route runs at a time; concurrent requests set a
//      pending flag and the runner loops once more against the LATEST state, so
//      a burst of K updates collapses to ~2 routes, never K.
//   2. Quick-then-full — each request runs a QUICK route immediately (reuses
//      cached faces, skips the crossing-swap pass: ~3-4× faster) for instant
//      feedback, and schedules a FULL best-quality route once the interaction
//      goes quiet. A pending full supersedes a pending quick.
// The headless export calls route() directly (always full), so committed/exported
// geometry is unaffected by this interactive path.
const FULL_ROUTE_DELAY_MS = 200
const rerouteState: {
  inFlight: boolean
  pendingQuick: boolean
  pendingFull: boolean
  fullTimer: ReturnType<typeof setTimeout> | undefined
} = { inFlight: false, pendingQuick: false, pendingFull: false, fullTimer: undefined }

export const useDiagramStore = create<DiagramStore>()(
  temporal(
    (set, get) => ({
      source: initialSource,
      layout: initialLayout,
      parseResult: initialParse,
      routed: null,
      selectedNodeIds: [],
      selectedAreaIds: [],
      selectedEdgeIds: [],
      showGrid: true,
      gridSize: 16,
      exportScale: 2,
      textScale: 1,
      fontFamily: 'inter',
      stylePanelPosition: null,

      setSource: (source) => set((s) => ({ ...s, source })),

      setLayout: (layout) => {
        // Wholesale layout replacement (layout-JSON editor) — positions change
        // for everything, so stale faces must not be reused by a quick route.
        invalidateFaceCache()
        set((s) => ({
          ...s,
          layout,
          gridSize: layout.gridSize,
        }))
      },

      moveNode: (id, x, y) =>
        set((s) => {
          const grid = s.layout.gridSize || s.gridSize
          const cx = Math.round(x / grid)
          const cy = Math.round(y / grid)
          const existing = s.layout.nodes[id]
          const nextNode = existing
            ? { ...existing, cx, cy }
            : { cx, cy, w: 4, h: 2 }
          return {
            ...s,
            layout: { ...s.layout, nodes: { ...s.layout.nodes, [id]: nextNode } },
          }
        }),

      moveNodes: (positions) =>
        set((s) => {
          const nextNodes = { ...s.layout.nodes }
          for (const [id, { cx, cy }] of Object.entries(positions)) {
            const ex = nextNodes[id]
            if (!ex) continue
            nextNodes[id] = { ...ex, cx, cy }
          }
          return {
            ...s,
            layout: { ...s.layout, nodes: nextNodes },
          }
        }),

      resizeNode: (id, side, pxX, pxY) =>
        set((s) => {
          const grid = s.layout.gridSize || s.gridSize
          const node = s.layout.nodes[id]
          if (!node) return s
          let { cx, cy, w, h } = node
          if (side === 'E') {
            const left = cx - w / 2
            const newRight = Math.round(pxX / grid)
            const newW = Math.max(1, newRight - left)
            w = newW
            cx = left + newW / 2
          } else if (side === 'W') {
            const right = cx + w / 2
            const newLeft = Math.round(pxX / grid)
            const newW = Math.max(1, right - newLeft)
            w = newW
            cx = right - newW / 2
          } else if (side === 'S') {
            const top = cy - h / 2
            const newBottom = Math.round(pxY / grid)
            const newH = Math.max(1, newBottom - top)
            h = newH
            cy = top + newH / 2
          } else {
            const bottom = cy + h / 2
            const newTop = Math.round(pxY / grid)
            const newH = Math.max(1, bottom - newTop)
            h = newH
            cy = bottom - newH / 2
          }
          return {
            ...s,
            layout: {
              ...s.layout,
              nodes: { ...s.layout.nodes, [id]: { ...node, cx, cy, w, h } },
            },
          }
        }),

      setEdgeSide: (edgeKey, end, side) =>
        set((s) => {
          const current = s.layout.edges[edgeKey] ?? {
            sourceSide: 'E' as Side,
            targetSide: 'W' as Side,
          }
          const next =
            end === 'source'
              ? { ...current, sourceSide: side }
              : { ...current, targetSide: side }
          return {
            ...s,
            layout: { ...s.layout, edges: { ...s.layout.edges, [edgeKey]: next } },
          }
        }),

      setEdgeLabelOffset: (edgeId, labelDx, labelDy) =>
        set((s) => {
          const key = edgeStyleKey(edgeId)
          const edges = { ...s.layout.edges }
          const next = { ...edges[key] }
          // Drop each axis when it returns to 0 (and the whole entry if it ends
          // up empty) so absent == 0 == auto-anchor and the sidecar diff stays
          // minimal — a pure vertical nudge never writes "labelDx": 0.
          if (labelDx === 0) delete next.labelDx
          else next.labelDx = labelDx
          if (labelDy === 0) delete next.labelDy
          else next.labelDy = labelDy
          if (Object.keys(next).length === 0) delete edges[key]
          else edges[key] = next
          return { ...s, layout: { ...s.layout, edges } }
        }),

      setNodeSize: (id, w, h) =>
        set((s) => {
          const existing = s.layout.nodes[id]
          const nextNode = existing ? { ...existing, w, h } : { cx: 0, cy: 0, w, h }
          return {
            ...s,
            layout: { ...s.layout, nodes: { ...s.layout.nodes, [id]: nextNode } },
          }
        }),

      selectNode: (id, additive) =>
        set((s) => {
          if (!id)
            return { ...s, selectedNodeIds: [], selectedAreaIds: [], selectedEdgeIds: [] }
          if (!additive)
            return { ...s, selectedNodeIds: [id], selectedAreaIds: [], selectedEdgeIds: [] }
          const cur = s.selectedNodeIds
          const idx = cur.indexOf(id)
          const next = idx >= 0
            ? [...cur.slice(0, idx), ...cur.slice(idx + 1)]
            : [...cur, id]
          return { ...s, selectedNodeIds: next }
        }),

      selectArea: (id, additive) =>
        set((s) => {
          if (!id)
            return { ...s, selectedNodeIds: [], selectedAreaIds: [], selectedEdgeIds: [] }
          if (!additive)
            return { ...s, selectedNodeIds: [], selectedAreaIds: [id], selectedEdgeIds: [] }
          const cur = s.selectedAreaIds
          const idx = cur.indexOf(id)
          const next = idx >= 0
            ? [...cur.slice(0, idx), ...cur.slice(idx + 1)]
            : [...cur, id]
          return { ...s, selectedAreaIds: next }
        }),

      selectEdge: (id, additive) =>
        set((s) => {
          if (!id)
            return { ...s, selectedNodeIds: [], selectedAreaIds: [], selectedEdgeIds: [] }
          // Edge styles are keyed by source->target (shared across parallel
          // edges), so selecting one edge selects every sibling that shares its
          // style key — what you select then matches what a style edit writes.
          const key = edgeStyleKey(id)
          const siblings = (s.routed?.edges ?? [])
            .map((e) => e.id)
            .filter((eid) => edgeStyleKey(eid) === key)
          const group = siblings.length > 0 ? siblings : [id]
          if (!additive)
            return { ...s, selectedNodeIds: [], selectedAreaIds: [], selectedEdgeIds: group }
          const cur = s.selectedEdgeIds
          const allSelected = group.every((g) => cur.includes(g))
          const next = allSelected
            ? cur.filter((g) => !group.includes(g))
            : Array.from(new Set([...cur, ...group]))
          return { ...s, selectedEdgeIds: next }
        }),

      setSelectedNodeIds: (ids) =>
        set((s) => ({ ...s, selectedNodeIds: Array.from(new Set(ids)) })),

      setSelectedAreaIds: (ids) =>
        set((s) => ({ ...s, selectedAreaIds: Array.from(new Set(ids)) })),

      setSelectedEdgeIds: (ids) =>
        set((s) => ({ ...s, selectedEdgeIds: Array.from(new Set(ids)) })),

      setSelection: (nodeIds, areaIds, edgeIds = []) =>
        set((s) => ({
          ...s,
          selectedNodeIds: Array.from(new Set(nodeIds)),
          selectedAreaIds: Array.from(new Set(areaIds)),
          selectedEdgeIds: Array.from(new Set(edgeIds)),
        })),

      clearSelection: () =>
        set((s) => ({
          ...s,
          selectedNodeIds: [],
          selectedAreaIds: [],
          selectedEdgeIds: [],
        })),

      setNodeStyle: (patch) =>
        set((s) => {
          if (s.selectedNodeIds.length === 0) return s
          const nodes = { ...s.layout.nodes }
          for (const id of s.selectedNodeIds) {
            const existing = nodes[id]
            if (!existing) continue
            nodes[id] = { ...existing, ...patch }
          }
          return { ...s, layout: { ...s.layout, nodes } }
        }),

      setEdgeStyle: (patch) =>
        set((s) => {
          if (s.selectedEdgeIds.length === 0) return s
          const edges = { ...s.layout.edges }
          for (const edgeId of s.selectedEdgeIds) {
            const key = edgeStyleKey(edgeId)
            edges[key] = { ...edges[key], ...patch }
          }
          return { ...s, layout: { ...s.layout, edges } }
        }),

      setAreaStyle: (patch) =>
        set((s) => {
          if (s.selectedAreaIds.length === 0) return s
          const areas = { ...(s.layout.areas ?? {}) }
          for (const id of s.selectedAreaIds) {
            areas[id] = { ...areas[id], ...patch }
          }
          return { ...s, layout: { ...s.layout, areas } }
        }),

      toggleGrid: () => set((s) => ({ ...s, showGrid: !s.showGrid })),

      setGridSize: (n) =>
        set((s) => {
          const clean = Math.max(2, Math.round(n))
          return {
            ...s,
            gridSize: clean,
            layout: { ...s.layout, gridSize: clean },
          }
        }),

      setExportScale: (scale) => set((s) => ({ ...s, exportScale: scale })),

      setTextScale: (scale) =>
        set((s) => ({
          ...s,
          textScale: Math.max(0.6, Math.min(2.4, scale)),
        })),

      setFontFamily: (fontFamily) => set((s) => ({ ...s, fontFamily })),

      setStylePanelPosition: (stylePanelPosition) =>
        set((s) => ({ ...s, stylePanelPosition })),

      reparse: () => {
        const { source } = get()
        const result = parse(source)
        set((s) => {
          if (!result.ok) return { ...s, parseResult: result }
          // Drop selection ids whose underlying element no longer exists, so a
          // later style edit can't write an orphan sidecar entry and the panel
          // doesn't linger over vanished elements.
          const nodeIds = new Set(result.diagram.nodes.map((n) => n.id))
          const areaIds = new Set(result.diagram.areas.map((a) => a.id))
          const edgeIds = new Set(
            result.diagram.edges.map((e, i) => makeEdgeId(e.source, e.target, i)),
          )
          return {
            ...s,
            parseResult: result,
            selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
            selectedAreaIds: s.selectedAreaIds.filter((id) => areaIds.has(id)),
            selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
          }
        })
      },

      reroute: async () => {
        const pump = async () => {
          if (rerouteState.inFlight) return
          rerouteState.inFlight = true
          try {
            while (rerouteState.pendingQuick || rerouteState.pendingFull) {
              // A pending full supersedes a pending quick — do the best-quality
              // pass when the interaction has settled.
              const quick = !rerouteState.pendingFull
              rerouteState.pendingQuick = false
              if (!quick) rerouteState.pendingFull = false
              const { parseResult, layout } = get()
              if (!parseResult.ok) {
                set((s) => ({ ...s, routed: null }))
                continue
              }
              try {
                // Synthesize layout entries for any `.d2` node missing from the
                // sidecar (e.g. CC appended a node without touching the layout)
                // so the canvas renders it auto-placed. The normalized layout is
                // used only for routing — never written back into the store — so
                // these positions can never bounce out to disk.
                const routed = await route(
                  parseResult.diagram,
                  normalizeForRoute(parseResult.diagram, layout),
                  { quick },
                )
                set((s) => ({ ...s, routed }))
              } catch (err) {
                console.error('route failed', err)
                set((s) => ({ ...s, routed: null }))
              }
            }
          } finally {
            rerouteState.inFlight = false
          }
        }

        // Immediate quick pass for instant feedback…
        rerouteState.pendingQuick = true
        await pump()
        // …then a full best-quality pass once changes stop arriving.
        if (rerouteState.fullTimer) clearTimeout(rerouteState.fullTimer)
        rerouteState.fullTimer = setTimeout(() => {
          rerouteState.fullTimer = undefined
          rerouteState.pendingFull = true
          void pump()
        }, FULL_ROUTE_DELAY_MS)
      },

      loadDocument: (source, layout) => {
        // Loading a document (bootstrap / open) is a fresh baseline, not an
        // undoable edit: pause tracking around the swap and clear history so
        // the user can't undo back into the previous (or empty) document.
        invalidateFaceCache()
        const temporal = useDiagramStore.temporal.getState()
        temporal.pause()
        set((s) => ({
          ...s,
          source,
          layout,
          gridSize: layout.gridSize,
          selectedNodeIds: [],
          selectedAreaIds: [],
          selectedEdgeIds: [],
        }))
        temporal.clear()
        temporal.resume()
      },

      applyRemote: (patch) => {
        // A remote layout write (bridge: disk/CC edit, pasted layout) replaces
        // positions wholesale — drop stale faces so the next quick route relearns.
        if (patch.layout !== undefined) invalidateFaceCache()
        // Apply with temporal PAUSED so the remote write creates no undo entry
        // and doesn't clear history (a transient reconnect must never wipe the
        // user's stack); then reset the burst window so the user's next local
        // edit opens a fresh, independently-undoable snapshot.
        const temporal = useDiagramStore.temporal.getState()
        temporal.pause()
        set((s) => ({
          ...s,
          ...(patch.source !== undefined ? { source: patch.source } : {}),
          ...(patch.layout !== undefined
            ? { layout: patch.layout, gridSize: patch.layout.gridSize }
            : {}),
        }))
        temporal.resume()
        flushBurst()
      },
    }),
    {
      limit: 100,
      // Only track source + layout for undo; viewport/selection/grid display are ephemeral.
      partialize: (state) => ({
        source: state.source,
        layout: state.layout,
      }),
      equality: (a, b) => a.source === b.source && a.layout === b.layout,
      // Group rapid edits (a burst of keystrokes, a drag) into one undo step:
      // record the state before the first change of a burst, then suppress
      // further snapshots until ~350ms of quiet. Without this, undo steps
      // through every keystroke and every intermediate drag position.
      handleSet: (handleSet) => {
        return (pastState, replace) => {
          if (!burstState.active) {
            burstState.active = true
            handleSet(pastState, replace)
          }
          if (burstState.timeout) clearTimeout(burstState.timeout)
          burstState.timeout = setTimeout(() => {
            burstState.active = false
          }, 350)
        }
      },
    },
  ),
)

export const useTemporalStore = useDiagramStore.temporal
