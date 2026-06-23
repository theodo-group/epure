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
  selectedNodeId: string | undefined
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
  setEdgeSide: (edgeKey: string, end: 'source' | 'target', side: Side) => void
  setNodeSize: (id: string, w: number, h: number) => void
  selectNode: (id: string | undefined) => void
  toggleGrid: () => void
  setGridSize: (n: number) => void
  setExportScale: (s: ExportScale) => void
  reparse: () => void
  reroute: () => Promise<void>
  loadDocument: (source: string, layout: LayoutSidecar, filename: string) => void
  markClean: () => void
}

export type DiagramStore = DiagramState & DiagramActions

const snap = (v: number, grid: number) => Math.round(v / grid) * grid

const initialSource = ''
const initialLayout: LayoutSidecar = {
  gridSize: 16,
  nodes: {},
  edges: {},
  areas: [],
}
const initialParse: ParseResult = { ok: false, errors: [] }

export const useDiagramStore = create<DiagramStore>()(
  temporal(
    (set, get) => ({
      source: initialSource,
      layout: initialLayout,
      parseResult: initialParse,
      routed: null,
      selectedNodeId: undefined,
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
          const sx = snap(x, grid)
          const sy = snap(y, grid)
          const existing = s.layout.nodes[id]
          const nextNode = existing
            ? { ...existing, x: sx, y: sy }
            : { x: sx, y: sy, w: 160, h: 64 }
          return {
            ...s,
            layout: { ...s.layout, nodes: { ...s.layout.nodes, [id]: nextNode } },
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
          const nextNode = existing ? { ...existing, w, h } : { x: 0, y: 0, w, h }
          return {
            ...s,
            layout: { ...s.layout, nodes: { ...s.layout.nodes, [id]: nextNode } },
            dirty: true,
          }
        }),

      selectNode: (id) => set((s) => ({ ...s, selectedNodeId: id })),

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
          // Adapt the parser AST to what route() needs: edges with an `id`.
          const adapted = {
            nodes: parseResult.diagram.nodes.map((n) => ({ id: n.id })),
            edges: parseResult.diagram.edges.map((e) => ({
              id: `${e.source}->${e.target}`,
              source: e.source,
              target: e.target,
              label: e.label,
              style: e.style,
              marker: e.direction,
            })),
          }
          const routed = await route(adapted, layout)
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
          selectedNodeId: undefined,
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
