import { useCallback, useRef, type FC, type MouseEvent } from 'react'

import type { ShapeName } from '@/parser/ast'
import type { Side } from '@/layout/types'
import type { FillColor, LineStyle, PaletteColor, Size } from '@/style/palette'
import {
  dashArrayFor,
  fillOf,
  solidOf,
  TEXT_SIZE,
} from '@/style/palette'

import { beginDrag, endDrag } from './dragState'

import {
  Cylinder,
  Document,
  Page,
  Person,
  Queue,
  Rectangle,
  type ShapeProps,
} from './shapes'

interface NodeProps {
  id: string
  shape: ShapeName
  label?: string
  x: number
  y: number
  w: number
  h: number
  selected?: boolean
  textSize?: Size
  textColor?: PaletteColor
  borderColor?: PaletteColor
  borderStyle?: LineStyle
  fillColor?: FillColor
  onSelect?: (id: string, additive: boolean) => void
  onMove?: (id: string, centerX: number, centerY: number, shiftKey: boolean) => void
  onResize?: (id: string, side: Side, pxX: number, pxY: number) => void
  gridSize: number
}

const SHAPE_COMPONENTS: Record<ShapeName, FC<ShapeProps>> = {
  rectangle: Rectangle,
  cylinder: Cylinder,
  cloud: Rectangle,
  person: Person,
  queue: Queue,
  document: Document,
  page: Page,
}

const AVG_CHAR_PX = 6.6
const RESIZE_HANDLE = 8

const wrapLabel = (label: string, w: number): string[] => {
  const maxChars = Math.max(4, Math.floor((w - 16) / AVG_CHAR_PX))
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [label]
}

export const Node: FC<NodeProps> = ({
  id,
  shape,
  label,
  x,
  y,
  w,
  h,
  selected,
  textSize,
  textColor,
  borderColor,
  borderStyle,
  fillColor,
  onSelect,
  onMove,
  onResize,
  gridSize,
}) => {
  const Shape = SHAPE_COMPONENTS[shape] ?? Rectangle
  const strokeColor = borderColor ? solidOf(borderColor) : '#3b4252'
  // `transparent` keeps the interior see-through but still hit-testable (unlike
  // `none`), so the node stays clickable/draggable by its whole body.
  const shapeFill =
    fillColor === 'transparent'
      ? 'transparent'
      : fillColor
        ? fillOf(fillColor)
        : '#ffffff'
  const dash = borderStyle ? dashArrayFor(borderStyle, 1.5) : undefined
  const fontSize = TEXT_SIZE[textSize ?? 'M']
  const labelFill = textColor ? solidOf(textColor) : '#1f2430'
  // Person shape fills its whole bounding box with a figure; render the
  // label below the figure instead of overlaying it.
  const labelBelow = shape === 'person'
  const labels = label ? wrapLabel(label, labelBelow ? w * 2 : w) : []
  const lineHeight = 14
  const blockH = labels.length * lineHeight
  const startY = labelBelow
    ? y + h + lineHeight
    : y + h / 2 - blockH / 2 + lineHeight * 0.8

  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 })

  const handlePointerDown = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      event.stopPropagation()
      const shift = event.shiftKey
      onSelect?.(id, shift)
      if (!onMove) return

      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return

      dragging.current = true
      beginDrag()
      const pt = svg.createSVGPoint()
      pt.x = event.clientX
      pt.y = event.clientY
      const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse())
      dragStart.current = { mx: svgPt.x, my: svgPt.y, cx: x + w / 2, cy: y + h / 2 }

      const onPointerMove = (e: globalThis.MouseEvent) => {
        if (!dragging.current) return
        const mp = svg.createSVGPoint()
        mp.x = e.clientX
        mp.y = e.clientY
        const sp = mp.matrixTransform(svg.getScreenCTM()?.inverse())
        const dx = sp.x - dragStart.current.mx
        const dy = sp.y - dragStart.current.my
        onMove(id, dragStart.current.cx + dx, dragStart.current.cy + dy, shift)
      }

      const onPointerUp = () => {
        dragging.current = false
        endDrag()
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }

      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [id, x, y, w, h, onSelect, onMove, gridSize],
  )

  const handleResizeDown = useCallback(
    (side: Side) => (event: MouseEvent<SVGRectElement>) => {
      event.stopPropagation()
      onSelect?.(id, false)
      if (!onResize) return

      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return

      beginDrag()
      const onMouseMove = (e: globalThis.MouseEvent) => {
        const pt = svg.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const inv = svg.getScreenCTM()?.inverse()
        if (!inv) return
        const sp = pt.matrixTransform(inv)
        onResize(id, side, sp.x, sp.y)
      }

      const onMouseUp = () => {
        endDrag()
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [id, onSelect, onResize],
  )

  return (
    <g
      data-node-id={id}
      onMouseDown={handlePointerDown}
      style={{ cursor: onMove ? 'grab' : 'pointer' }}
    >
      <Shape
        x={x}
        y={y}
        w={w}
        h={h}
        fill={shapeFill}
        stroke={strokeColor}
        strokeDasharray={dash}
      />
      {selected ? (
        <rect
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={h + 6}
          rx={8}
          ry={8}
          fill='none'
          stroke='#3b82f6'
          strokeWidth={1.5}
          strokeDasharray='4 3'
          pointerEvents='none'
        />
      ) : null}
      {labels.map((line, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={startY + i * lineHeight}
          textAnchor='middle'
          fontFamily='Inter, system-ui, sans-serif'
          fontSize={fontSize}
          fill={labelFill}
          pointerEvents='none'
        >
          {line}
        </text>
      ))}
      {onResize ? (
        <>
          <rect
            x={x - RESIZE_HANDLE / 2}
            y={y + RESIZE_HANDLE}
            width={RESIZE_HANDLE}
            height={h - RESIZE_HANDLE * 2}
            fill='transparent'
            style={{ cursor: 'ew-resize' }}
            onMouseDown={handleResizeDown('W')}
          />
          <rect
            x={x + w - RESIZE_HANDLE / 2}
            y={y + RESIZE_HANDLE}
            width={RESIZE_HANDLE}
            height={h - RESIZE_HANDLE * 2}
            fill='transparent'
            style={{ cursor: 'ew-resize' }}
            onMouseDown={handleResizeDown('E')}
          />
          <rect
            x={x + RESIZE_HANDLE}
            y={y - RESIZE_HANDLE / 2}
            width={w - RESIZE_HANDLE * 2}
            height={RESIZE_HANDLE}
            fill='transparent'
            style={{ cursor: 'ns-resize' }}
            onMouseDown={handleResizeDown('N')}
          />
          <rect
            x={x + RESIZE_HANDLE}
            y={y + h - RESIZE_HANDLE / 2}
            width={w - RESIZE_HANDLE * 2}
            height={RESIZE_HANDLE}
            fill='transparent'
            style={{ cursor: 'ns-resize' }}
            onMouseDown={handleResizeDown('S')}
          />
        </>
      ) : null}
    </g>
  )
}
