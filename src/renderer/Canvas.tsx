import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'

import type { EdgeDirection, EdgeStyle, ShapeName } from '@/parser/ast'
import type { RoutedDiagram, Side } from '@/layout/types'

import { Area } from './Area'
import { beginDrag, endDrag } from './dragState'
import { Edge, EdgeDefs } from './Edge'
import { Grid } from './Grid'
import { Node } from './Node'

export interface NodeMeta {
  shape: ShapeName
  label?: string
}

export interface EdgeMeta {
  label?: string
  style?: EdgeStyle
  marker?: EdgeDirection
}

interface CanvasProps {
  diagram: RoutedDiagram
  showGrid: boolean
  selectedNodeIds?: string[]
  selectedAreaIds?: string[]
  onSelectNode?: (id: string, additive: boolean) => void
  onSelectArea?: (id: string, additive: boolean) => void
  onMarqueeSelect?: (
    nodeIds: string[],
    areaIds: string[],
    additive: boolean,
  ) => void
  onMoveNode?: (id: string, centerX: number, centerY: number, shiftKey: boolean) => void
  onResizeNode?: (id: string, side: Side, pxX: number, pxY: number) => void
  onAreaDragStart?: (areaId: string) => void
  onAreaDragMove?: (areaId: string, dxPixels: number, dyPixels: number) => void
  /** Increment to refit the view to current content bounds. */
  fitVersion?: number
  nodes?: Record<string, NodeMeta>
  edges?: Record<string, EdgeMeta>
}

const computeBounds = (diagram: RoutedDiagram) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const a of diagram.areas) {
    minX = Math.min(minX, a.x)
    minY = Math.min(minY, a.y)
    maxX = Math.max(maxX, a.x + a.w)
    maxY = Math.max(maxY, a.y + a.h)
  }
  for (const n of diagram.nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  for (const e of diagram.edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }

  if (!isFinite(minX)) return { x: 0, y: 0, w: 800, h: 600 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const INIT_PADDING = 48
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

export const Canvas = forwardRef<SVGSVGElement, CanvasProps>(
  (
    {
      diagram,
      showGrid,
      selectedNodeIds,
      selectedAreaIds,
      onSelectNode,
      onSelectArea,
      onMarqueeSelect,
      onMoveNode,
      onResizeNode,
      onAreaDragStart,
      onAreaDragMove,
      fitVersion,
      nodes = {},
      edges = {},
    },
    ref,
  ) => {
    const svgRef = useRef<SVGSVGElement>(null)
    useImperativeHandle(ref, () => svgRef.current!, [])

    const [container, setContainer] = useState({ w: 800, h: 600 })
    const [view, setView] = useState<
      { cx: number; cy: number; zoom: number } | null
    >(null)

    // Track container size.
    useLayoutEffect(() => {
      const svg = svgRef.current
      if (!svg) return
      const update = () => {
        const r = svg.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          setContainer({ w: r.width, h: r.height })
        }
      }
      update()
      const obs = new ResizeObserver(update)
      obs.observe(svg)
      return () => obs.disconnect()
    }, [])

    const fitNow = () => {
      const b = computeBounds(diagram)
      if (b.w === 0 && b.h === 0) return
      const zoom = Math.min(
        container.w / Math.max(1, b.w + INIT_PADDING * 2),
        container.h / Math.max(1, b.h + INIT_PADDING * 2),
        1,
      )
      setView({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, zoom })
    }

    // Initialize view to fit content the first time we have a non-empty diagram.
    useEffect(() => {
      if (view !== null) return
      fitNow()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagram, container, view])

    // Refit on demand whenever the parent bumps fitVersion.
    const lastFitVersion = useRef<number | undefined>(undefined)
    useEffect(() => {
      if (fitVersion === undefined) return
      if (lastFitVersion.current === fitVersion) return
      lastFitVersion.current = fitVersion
      fitNow()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitVersion])

    const z = view?.zoom ?? 1
    const cx = view?.cx ?? 0
    const cy = view?.cy ?? 0
    const viewBoxW = container.w / z
    const viewBoxH = container.h / z
    const viewBoxX = cx - viewBoxW / 2
    const viewBoxY = cy - viewBoxH / 2

    const [marquee, setMarquee] = useState<
      { x1: number; y1: number; x2: number; y2: number } | null
    >(null)

    const clientToSvg = (cxScreen: number, cyScreen: number) => {
      const svg = svgRef.current
      if (!svg || !view) return { x: 0, y: 0 }
      const r = svg.getBoundingClientRect()
      const sx = (cxScreen - r.left) / r.width
      const sy = (cyScreen - r.top) / r.height
      const vbW = r.width / view.zoom
      const vbH = r.height / view.zoom
      return {
        x: view.cx - vbW / 2 + sx * vbW,
        y: view.cy - vbH / 2 + sy * vbH,
      }
    }

    // Background mousedown → marquee selection (Excalidraw-style). Hold
    // shift to add to the existing selection.
    const handleBackgroundMouseDown = (event: MouseEvent<SVGSVGElement>) => {
      if (!view) return
      event.preventDefault()
      const start = clientToSvg(event.clientX, event.clientY)
      const additive = event.shiftKey
      const startScreenX = event.clientX
      const startScreenY = event.clientY
      let dragged = false
      setMarquee({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })
      beginDrag()

      const onMove = (e: globalThis.MouseEvent) => {
        if (
          !dragged &&
          Math.hypot(e.clientX - startScreenX, e.clientY - startScreenY) > 3
        ) {
          dragged = true
        }
        const cur = clientToSvg(e.clientX, e.clientY)
        setMarquee((m) => (m ? { ...m, x2: cur.x, y2: cur.y } : m))
      }

      const onUp = () => {
        endDrag()
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (!dragged) {
          setMarquee(null)
          if (!additive) onSelectNode?.('', false)
          return
        }
        const end = clientToSvg(
          startScreenX + (event.clientX - startScreenX),
          startScreenY + (event.clientY - startScreenY),
        )
        // Compute from the latest marquee state via setter to avoid stale data.
        setMarquee((m) => {
          const x1 = Math.min(m?.x1 ?? start.x, m?.x2 ?? end.x)
          const y1 = Math.min(m?.y1 ?? start.y, m?.y2 ?? end.y)
          const x2 = Math.max(m?.x1 ?? start.x, m?.x2 ?? end.x)
          const y2 = Math.max(m?.y1 ?? start.y, m?.y2 ?? end.y)
          // Only select items fully enclosed in the marquee rectangle.
          const nodeHits = diagram.nodes
            .filter(
              (n) =>
                n.x >= x1 && n.x + n.w <= x2 && n.y >= y1 && n.y + n.h <= y2,
            )
            .map((n) => n.id)
          const areaHits = diagram.areas
            .filter(
              (a) =>
                a.x >= x1 && a.x + a.w <= x2 && a.y >= y1 && a.y + a.h <= y2,
            )
            .map((a) => a.id)
          onMarqueeSelect?.(nodeHits, areaHits, additive)
          return null
        })
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    // Wheel: Cmd/Ctrl + scroll zooms (with the cursor as anchor). Plain
    // scroll pans (both axes, like Excalidraw). Shift + scroll converts
    // vertical wheel into horizontal pan. React's onWheel is passive by
    // default, so attach manually to enable preventDefault.
    useEffect(() => {
      const svg = svgRef.current
      if (!svg) return
      const onWheel = (event: globalThis.WheelEvent) => {
        event.preventDefault()
        setView((v) => {
          if (!v) return v
          if (event.ctrlKey || event.metaKey) {
            const r = svg.getBoundingClientRect()
            const sx = (event.clientX - r.left) / r.width
            const sy = (event.clientY - r.top) / r.height
            const vbW = r.width / v.zoom
            const vbH = r.height / v.zoom
            const anchorX = v.cx - vbW / 2 + sx * vbW
            const anchorY = v.cy - vbH / 2 + sy * vbH
            const factor = Math.exp(-event.deltaY * 0.0015)
            const newZoom = Math.max(
              MIN_ZOOM,
              Math.min(MAX_ZOOM, v.zoom * factor),
            )
            if (newZoom === v.zoom) return v
            const newCx = anchorX - (anchorX - v.cx) * (v.zoom / newZoom)
            const newCy = anchorY - (anchorY - v.cy) * (v.zoom / newZoom)
            return { cx: newCx, cy: newCy, zoom: newZoom }
          }
          // With Shift held, treat the scroll as horizontal pan regardless
          // of which axis carries the delta — browsers (esp. macOS) often
          // swap deltaY into deltaX automatically when Shift is down.
          let dx: number
          let dy: number
          if (event.shiftKey) {
            dx = event.deltaX !== 0 ? event.deltaX : event.deltaY
            dy = 0
          } else {
            dx = event.deltaX
            dy = event.deltaY
          }
          return { ...v, cx: v.cx + dx / v.zoom, cy: v.cy + dy / v.zoom }
        })
      }
      svg.addEventListener('wheel', onWheel, { passive: false })
      return () => svg.removeEventListener('wheel', onWheel)
    }, [])

    return (
      <svg
        ref={svgRef}
        xmlns='http://www.w3.org/2000/svg'
        viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`}
        preserveAspectRatio='xMidYMid meet'
        onMouseDown={handleBackgroundMouseDown}
        style={{ width: '100%', height: '100%', cursor: 'default' }}
      >
        <EdgeDefs />
        <g>
          {showGrid ? (
            <Grid
              x={viewBoxX}
              y={viewBoxY}
              width={viewBoxW}
              height={viewBoxH}
              gridSize={diagram.gridSize}
            />
          ) : null}
          {diagram.areas.map((area) => (
            <Area
              key={area.id}
              area={area}
              selected={selectedAreaIds?.includes(area.id) ?? false}
              onSelect={onSelectArea}
              onDragStart={onAreaDragStart}
              onDragMove={onAreaDragMove}
            />
          ))}
          {diagram.edges.map((edge) => {
            const meta = edges[edge.id] ?? {}
            return (
              <Edge
                key={edge.id}
                edge={edge}
                label={meta.label}
                style={meta.style}
                marker={meta.marker}
              />
            )
          })}
          {diagram.nodes.map((node) => {
            const meta = nodes[node.id] ?? { shape: 'rectangle' as ShapeName }
            return (
              <Node
                key={node.id}
                id={node.id}
                shape={meta.shape ?? 'rectangle'}
                label={meta.label}
                x={node.x}
                y={node.y}
                w={node.w}
                h={node.h}
                selected={selectedNodeIds?.includes(node.id) ?? false}
                onSelect={onSelectNode}
                onMove={onMoveNode}
                onResize={onResizeNode}
                gridSize={diagram.gridSize}
              />
            )
          })}
          {marquee ? (
            <rect
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              fill='rgba(59, 130, 246, 0.08)'
              stroke='#3b82f6'
              strokeWidth={1 / z}
              strokeDasharray={`${4 / z} ${3 / z}`}
              pointerEvents='none'
            />
          ) : null}
        </g>
      </svg>
    )
  },
)

Canvas.displayName = 'Canvas'
