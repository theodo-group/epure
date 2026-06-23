import type { FC, MouseEvent } from 'react'

import type { ShapeName } from '@/parser/ast'

import {
  Cloud,
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
}

const SHAPE_COMPONENTS: Record<ShapeName, FC<ShapeProps>> = {
  rectangle: Rectangle,
  cylinder: Cylinder,
  cloud: Cloud,
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
}) => {
  const Shape = SHAPE_COMPONENTS[shape] ?? Rectangle
  const lines = label ? wrapLabel(label, w) : []
  const lineHeight = 14
  const blockH = lines.length * lineHeight
  const startY = y + h / 2 - blockH / 2 + lineHeight * 0.8

  const handleClick = (event: MouseEvent<SVGGElement>) => {
    event.stopPropagation()
    onSelect?.(id)
  }

  return (
    <g data-node-id={id} onClick={handleClick} style={{ cursor: 'pointer' }}>
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
