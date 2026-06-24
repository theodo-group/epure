import { create } from 'zustand'
import { temporal } from 'zundo'
import type { ParseResult } from '@/parser/ast'
import { parse } from '@/parser'
import type { LayoutSidecar, RoutedDiagram, Side } from '@/layout/types'
import { route } from '@/layout/elk'

export type ExportScale = 1 | 2 | 4

export interface DiagramState {
  source: string
  layout: LayoutSidecar
  parseResult: ParseResult
  routed: RoutedDiagram | null
  selectedNodeIds: string[]
  selectedAreaIds: string[]
  showGrid: boolean
  gridSize: number
  exportScale: ExportScale
  filename: string
  dirty: boolean
}

export interface DiagramActions {
  setSource: (source: string) => void
  setLayout: (layout: LayoutSidecar) => void
  setFilename: (name: string) => void
  moveNode: (id: string, x: number, y: number) => void
  moveNodes: (positions: Record<string, { cx: number; cy: number }>) => void
  resizeNode: (id: string, side: Side, pxX: number, pxY: number) => void
  setEdgeSide: (edgeKey: string, end: 'source' | 'target', side: Side) => void
  setNodeSize: (id: string, w: number, h: number) => void
  selectNode: (id: string | undefined, additive?: boolean) => void
  selectArea: (id: string | undefined, additive?: boolean) => void
  setSelectedNodeIds: (ids: string[]) => void
  setSelectedAreaIds: (ids: string[]) => void
  setSelection: (nodeIds: string[], areaIds: string[]) => void
  clearSelection: () => void
  toggleGrid: () => void
  setGridSize: (n: number) => void
  setExportScale: (s: ExportScale) => void
  reparse: () => void
  reroute: () => Promise<void>
  loadDocument: (source: string, layout: LayoutSidecar, filename: string) => void
  markClean: () => void
}

export type DiagramStore = DiagramState & DiagramActions

const initialSource = ''
const initialLayout: LayoutSidecar = {
  gridSize: 40,
  nodes: {},
  edges: {},
}
const initialParse: ParseResult = { ok: false, errors: [] }

export const useDiagramStore = create<DiagramStore>()(
  temporal(
    (set, get) => ({
      source: initialSource,
      layout: initialLayout,
      parseResult: initialParse,
      routed: null,
      selectedNodeIds: [],
      selectedAreaIds: [],
      showGrid: true,
      gridSize: 16,
      exportScale: 2,
      filename: 'system.arch',
      dirty: false,

      setSource: (source) =>
        set((s) => ({ ...s, source, dirty: true })),

      setLayout: (layout) =>
        set((s) => ({
          ...s,
          layout,
          gridSize: layout.gridSize,
          dirty: true,
        })),

      setFilename: (name) => set((s) => ({ ...s, filename: name })),

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
            dirty: true,
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
            dirty: true,
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
              nodes: { ...s.layout.nodes, [id]: { cx, cy, w, h } },
            },
            dirty: true,
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
            dirty: true,
          }
        }),

      setNodeSize: (id, w, h) =>
        set((s) => {
          const existing = s.layout.nodes[id]
          const nextNode = existing ? { ...existing, w, h } : { cx: 0, cy: 0, w, h }
          return {
            ...s,
            layout: { ...s.layout, nodes: { ...s.layout.nodes, [id]: nextNode } },
            dirty: true,
          }
        }),

      selectNode: (id, additive) =>
        set((s) => {
          if (!id) return { ...s, selectedNodeIds: [], selectedAreaIds: [] }
          if (!additive) return { ...s, selectedNodeIds: [id], selectedAreaIds: [] }
          const cur = s.selectedNodeIds
          const idx = cur.indexOf(id)
          const next = idx >= 0
            ? [...cur.slice(0, idx), ...cur.slice(idx + 1)]
            : [...cur, id]
          return { ...s, selectedNodeIds: next }
        }),

      selectArea: (id, additive) =>
        set((s) => {
          if (!id) return { ...s, selectedNodeIds: [], selectedAreaIds: [] }
          if (!additive) return { ...s, selectedNodeIds: [], selectedAreaIds: [id] }
          const cur = s.selectedAreaIds
          const idx = cur.indexOf(id)
          const next = idx >= 0
            ? [...cur.slice(0, idx), ...cur.slice(idx + 1)]
            : [...cur, id]
          return { ...s, selectedAreaIds: next }
        }),

      setSelectedNodeIds: (ids) =>
        set((s) => ({ ...s, selectedNodeIds: Array.from(new Set(ids)) })),

      setSelectedAreaIds: (ids) =>
        set((s) => ({ ...s, selectedAreaIds: Array.from(new Set(ids)) })),

      setSelection: (nodeIds, areaIds) =>
        set((s) => ({
          ...s,
          selectedNodeIds: Array.from(new Set(nodeIds)),
          selectedAreaIds: Array.from(new Set(areaIds)),
        })),

      clearSelection: () =>
        set((s) => ({ ...s, selectedNodeIds: [], selectedAreaIds: [] })),

      toggleGrid: () => set((s) => ({ ...s, showGrid: !s.showGrid })),

      setGridSize: (n) =>
        set((s) => {
          const clean = Math.max(2, Math.round(n))
          return {
            ...s,
            gridSize: clean,
            layout: { ...s.layout, gridSize: clean },
            dirty: true,
          }
        }),

      setExportScale: (scale) => set((s) => ({ ...s, exportScale: scale })),

      reparse: () => {
        const { source } = get()
        const result = parse(source)
        set((s) => ({ ...s, parseResult: result }))
      },

      reroute: async () => {
        const { parseResult, layout } = get()
        if (!parseResult.ok) {
          set((s) => ({ ...s, routed: null }))
          return
        }
        try {
          const routed = await route(parseResult.diagram, layout)
          set((s) => ({ ...s, routed }))
        } catch (err) {
          console.error('route failed', err)
          set((s) => ({ ...s, routed: null }))
        }
      },

      loadDocument: (source, layout, filename) =>
        set((s) => ({
          ...s,
          source,
          layout,
          gridSize: layout.gridSize,
          filename,
          dirty: false,
          selectedNodeIds: [],
      selectedAreaIds: [],
        })),

      markClean: () => set((s) => ({ ...s, dirty: false })),
    }),
    {
      limit: 100,
      // Only track source + layout for undo; viewport/selection/grid display are ephemeral.
      partialize: (state) => ({
        source: state.source,
        layout: state.layout,
      }),
      equality: (a, b) => a.source === b.source && a.layout === b.layout,
    },
  ),
)

export const useTemporalStore = useDiagramStore.temporal
