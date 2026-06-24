import { useCallback, useRef, type FC, type MouseEvent } from 'react'

import type { ShapeName } from '@/parser/ast'

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
  onSelect?: (id: string) => void
  onMove?: (id: string, centerX: number, centerY: number) => void
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
  onSelect,
  onMove,
  gridSize,
}) => {
  const Shape = SHAPE_COMPONENTS[shape] ?? Rectangle
  const lines = label ? wrapLabel(label, w) : []
  const lineHeight = 14
  const blockH = lines.length * lineHeight
  const startY = y + h / 2 - blockH / 2 + lineHeight * 0.8

  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 })

  const handlePointerDown = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      event.stopPropagation()
      onSelect?.(id)
      if (!onMove) return

      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return

      dragging.current = true
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
        const newCx = dragStart.current.cx + dx
        const newCy = dragStart.current.cy + dy
        onMove(id, newCx, newCy)
      }

      const onPointerUp = () => {
        dragging.current = false
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }

      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [id, x, y, w, h, onSelect, onMove, gridSize],
  )

  return (
    <g
      data-node-id={id}
      onMouseDown={handlePointerDown}
      style={{ cursor: onMove ? 'grab' : 'pointer' }}
    >
      <Shape x={x} y={y} w={w} h={h} />
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
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={startY + i * lineHeight}
          textAnchor='middle'
          fontFamily='Inter, system-ui, sans-serif'
          fontSize={12}
          fill='#1f2430'
        >
          {line}
        </text>
      ))}
    </g>
  )
}
