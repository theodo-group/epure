import { useCallback, useRef, type FC, type MouseEvent } from 'react'

import type { AreaLayout } from '@/layout/types'
import { dashArrayFor, fillOf, solidOf } from '@/style/palette'

import { beginDrag, endDrag } from './dragState'

interface AreaProps {
  area: AreaLayout
  selected?: boolean
  onSelect?: (areaId: string, additive: boolean) => void
  onDragStart?: (areaId: string) => void
  onDragMove?: (areaId: string, dxPixels: number, dyPixels: number) => void
}

export const Area: FC<AreaProps> = ({
  area,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
}) => {
  const draggingRef = useRef(false)
  const startRef = useRef({ mx: 0, my: 0 })

  const handleMouseDown = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      event.stopPropagation()
      onSelect?.(area.id, event.shiftKey)
      if (!onDragMove) return

      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return

      draggingRef.current = true
      beginDrag()
      const pt = svg.createSVGPoint()
      pt.x = event.clientX
      pt.y = event.clientY
      const inverse = svg.getScreenCTM()?.inverse()
      if (!inverse) return
      const sp = pt.matrixTransform(inverse)
      startRef.current = { mx: sp.x, my: sp.y }

      onDragStart?.(area.id)

      const onMove = (e: globalThis.MouseEvent) => {
        if (!draggingRef.current) return
        const mp = svg.createSVGPoint()
        mp.x = e.clientX
        mp.y = e.clientY
        const inv = svg.getScreenCTM()?.inverse()
        if (!inv) return
        const cur = mp.matrixTransform(inv)
        onDragMove(area.id, cur.x - startRef.current.mx, cur.y - startRef.current.my)
      }

      const onUp = () => {
        draggingRef.current = false
        endDrag()
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [area.id, onSelect, onDragStart, onDragMove],
  )

  return (
    <g
      data-area-id={area.id}
      onMouseDown={handleMouseDown}
      style={{ cursor: onDragMove ? 'grab' : 'default' }}
    >
      <rect
        x={area.x}
        y={area.y}
        width={area.w}
        height={area.h}
        rx={12}
        ry={12}
        fill={
          area.fillColor === 'transparent'
            ? 'transparent'
            : area.fillColor
              ? fillOf(area.fillColor)
              : '#f4f5f9'
        }
        stroke={area.borderColor ? solidOf(area.borderColor) : '#cdd2dd'}
        strokeWidth={1}
        strokeDasharray={dashArrayFor(area.borderStyle ?? 'dashed', 1)}
      />
      {selected ? (
        <rect
          x={area.x - 4}
          y={area.y - 4}
          width={area.w + 8}
          height={area.h + 8}
          rx={16}
          ry={16}
          fill='none'
          stroke='#3b82f6'
          strokeWidth={1.5}
          strokeDasharray='4 3'
          pointerEvents='none'
        />
      ) : null}
      {area.label ? (
        <text
          x={area.x + 12}
          y={area.y + 20}
          fontFamily='Inter, system-ui, sans-serif'
          fontSize={12}
          fontWeight={600}
          fill='#5b6478'
        >
          {area.label}
        </text>
      ) : null}
    </g>
  )
}
