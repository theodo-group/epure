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
  onToggleGrid?: () => void
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
  onFitView?: () => void
  nodes?: Record<string, NodeMeta>
  edges?: Record<string, EdgeMeta>
}

type Tool = 'select' | 'pan'

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
const ZOOM_STEP = 1.2

export const Canvas = forwardRef<SVGSVGElement, CanvasProps>(
  (
    {
      diagram,
      showGrid,
      onToggleGrid,
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
      onFitView,
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
    const [tool, setTool] = useState<Tool>('select')
    const [spaceHeld, setSpaceHeld] = useState(false)

    const panActive = tool === 'pan' || spaceHeld

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

    // Space-to-pan, V/H tool hotkeys.
    useEffect(() => {
      const isTypingTarget = (el: EventTarget | null) => {
        if (!(el instanceof HTMLElement)) return false
        if (el.isContentEditable) return true
        const tag = el.tagName
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      }
      const onDown = (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault()
          setSpaceHeld(true)
        } else if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) {
          setTool('select')
        } else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) {
          setTool('pan')
        } else if (e.key === '1' && !e.metaKey && !e.ctrlKey) {
          setTool('select')
        } else if (e.key === '2' && !e.metaKey && !e.ctrlKey) {
          setTool('pan')
        }
      }
      const onUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') setSpaceHeld(false)
      }
      window.addEventListener('keydown', onDown)
      window.addEventListener('keyup', onUp)
      return () => {
        window.removeEventListener('keydown', onDown)
        window.removeEventListener('keyup', onUp)
      }
    }, [])

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

    // Background mousedown — pan when the pan tool is active or Space is held,
    // otherwise start a marquee selection. Shift adds to the selection.
    const handleBackgroundMouseDown = (event: MouseEvent<SVGSVGElement>) => {
      if (!view) return
      event.preventDefault()

      if (panActive) {
        const startScreenX = event.clientX
        const startScreenY = event.clientY
        const startCx = view.cx
        const startCy = view.cy
        beginDrag()
        const onMove = (e: globalThis.MouseEvent) => {
          setView((v) => {
            if (!v) return v
            const dxScreen = e.clientX - startScreenX
            const dyScreen = e.clientY - startScreenY
            return {
              ...v,
              cx: startCx - dxScreen / v.zoom,
              cy: startCy - dyScreen / v.zoom,
            }
          })
        }
        const onUp = () => {
          endDrag()
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }

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
        setMarquee((m) => {
          const x1 = Math.min(m?.x1 ?? start.x, m?.x2 ?? end.x)
          const y1 = Math.min(m?.y1 ?? start.y, m?.y2 ?? end.y)
          const x2 = Math.max(m?.x1 ?? start.x, m?.x2 ?? end.x)
          const y2 = Math.max(m?.y1 ?? start.y, m?.y2 ?? end.y)
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

    // Wheel zoom/pan.
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

    const zoomBy = (factor: number) => {
      setView((v) => {
        if (!v) return v
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor))
        return { ...v, zoom: newZoom }
      })
    }

    const resetZoom = () => {
      setView((v) => (v ? { ...v, zoom: 1 } : v))
    }

    const handleFit = () => {
      if (onFitView) onFitView()
      else fitNow()
    }

    const cursor = panActive ? 'grab' : 'default'

    return (
      <div className="pane-canvas-inner" style={{ position: 'absolute', inset: 0 }}>
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`}
          preserveAspectRatio="xMidYMid meet"
          onMouseDown={handleBackgroundMouseDown}
          className="ag-canvas-svg"
          style={{ cursor }}
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
                  textSize={node.textSize}
                  textColor={node.textColor}
                  borderColor={node.borderColor}
                  borderStyle={node.borderStyle}
                  fillColor={node.fillColor}
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
                fill="oklch(0.55 0.16 250 / 0.08)"
                stroke="oklch(0.55 0.16 250)"
                strokeWidth={1 / z}
                strokeDasharray={`${4 / z} ${3 / z}`}
                pointerEvents="none"
              />
            ) : null}
          </g>
        </svg>

        {/* Top-left: tool palette + hint */}
        <div className="ag-canvas-floating" style={{ top: 16, left: 16 }}>
          <div className="ag-tool-palette" role="toolbar" aria-label="Tools">
            <button
              type="button"
              title="Select — V"
              className={`ag-tool ${tool === 'select' ? 'active' : ''}`}
              onClick={() => setTool('select')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M3 2 L13 8 L8 9.2 L11 14 L9 14.8 L6 10 L3 13 Z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="ag-tool-key">1</span>
            </button>
            <button
              type="button"
              title="Pan — H or Space"
              className={`ag-tool ${tool === 'pan' ? 'active' : ''}`}
              onClick={() => setTool('pan')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M5 8 V4.5 a1 1 0 0 1 2 0 V7 V3.5 a1 1 0 0 1 2 0 V7 V4.5 a1 1 0 0 1 2 0 V8 V6 a1 1 0 0 1 2 0 V11 C13 13 11 14 9 14 H8 C6.5 14 5 13 5 11 Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span className="ag-tool-key">2</span>
            </button>
          </div>
          <div className="ag-hint">
            <span>Hold</span>
            <span className="ag-kbd">Space</span>
            <span>or</span>
            <span className="ag-kbd">Scroll</span>
            <span>to pan, or use the hand tool</span>
          </div>
        </div>

        {/* Bottom-right: zoom dock */}
        <div className="ag-zoom-dock">
          <div className="ag-zoom-pill">
            <button
              className="ag-zoom-btn"
              title="Zoom out"
              type="button"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M3 8 H 13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className="ag-zoom-readout"
              title="Reset to 100%"
              type="button"
              onClick={resetZoom}
            >
              {Math.round(z * 100)}%
            </button>
            <button
              className="ag-zoom-btn"
              title="Zoom in"
              type="button"
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M3 8 H 13 M8 3 V 13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <button className="ag-fit" type="button" onClick={handleFit}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 6 V3 H6 M10 3 H13 V6 M13 10 V13 H10 M6 13 H3 V10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Fit
          </button>
          <button
            className={`ag-grid-toggle ${showGrid ? 'active' : ''}`}
            title="Toggle grid"
            type="button"
            onClick={onToggleGrid}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M2 5.5 H14 M2 10.5 H14 M5.5 2 V14 M10.5 2 V14"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    )
  },
)

Canvas.displayName = 'Canvas'
