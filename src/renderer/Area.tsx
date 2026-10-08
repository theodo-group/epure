import { useCallback, useEffect, useRef, type CSSProperties, type FC, type MouseEvent } from 'react'

import { areaTitleRect } from '@/layout/areaTitle'
import type { AreaLayout } from '@/layout/types'
import { dashArrayFor, resolveFill, solidOf } from '@/style/palette'

import { beginDrag, endDrag } from './dragState'

interface AreaPointerProps {
  onSelect?: (areaId: string, additive: boolean) => void
  onDragStart?: (areaId: string) => void
  onDragMove?: (areaId: string, dxPixels: number, dyPixels: number) => void
  /** Double-click opens the inline title editor (adds a title when none). */
  onStartEdit?: (areaId: string) => void
}

interface AreaProps extends AreaPointerProps {
  area: AreaLayout
  selected?: boolean
}

// Select + drag on mousedown. Shared by the frame and its title chip so the
// chip stays a grab handle for the group.
const useAreaMouseDown = (
  areaId: string,
  { onSelect, onDragStart, onDragMove }: AreaPointerProps,
) => {
  const draggingRef = useRef(false)
  const startRef = useRef({ mx: 0, my: 0 })

  const handleMouseDown = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      event.stopPropagation()
      onSelect?.(areaId, event.shiftKey)
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

      onDragStart?.(areaId)

      const onMove = (e: globalThis.MouseEvent) => {
        if (!draggingRef.current) return
        const mp = svg.createSVGPoint()
        mp.x = e.clientX
        mp.y = e.clientY
        const inv = svg.getScreenCTM()?.inverse()
        if (!inv) return
        const cur = mp.matrixTransform(inv)
        onDragMove(areaId, cur.x - startRef.current.mx, cur.y - startRef.current.my)
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
    [areaId, onSelect, onDragStart, onDragMove],
  )
  return handleMouseDown
}

export const Area: FC<AreaProps> = ({ area, selected, ...pointer }) => {
  const handleMouseDown = useAreaMouseDown(area.id, pointer)
  const { onDragMove, onStartEdit } = pointer
  return (
    <g
      data-area-id={area.id}
      onMouseDown={handleMouseDown}
      onDoubleClick={
        onStartEdit
          ? (e) => {
              e.stopPropagation()
              onStartEdit(area.id)
            }
          : undefined
      }
      style={{ cursor: onDragMove ? 'grab' : 'default' }}
    >
      <rect
        x={area.x}
        y={area.y}
        width={area.w}
        height={area.h}
        rx={12}
        ry={12}
        fill={resolveFill(area.fillColor) ?? '#f4f5f9'}
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
    </g>
  )
}

const LABEL_FONT = 12

interface AreaLabelProps extends AreaPointerProps {
  area: AreaLayout
  textScale?: number
  fontFamily?: string
}

// Rendered as a separate pass *after* nodes so the label never disappears
// underneath a dragged child; positioned as a tab straddling the top border.
export const AreaLabel: FC<AreaLabelProps> = ({
  area,
  textScale = 1,
  fontFamily = 'Inter, system-ui, sans-serif',
  ...pointer
}) => {
  const handleMouseDown = useAreaMouseDown(area.id, pointer)
  const { onStartEdit } = pointer
  if (!area.label) return null
  const accent = area.borderColor ? solidOf(area.borderColor) : '#5b6478'
  const chip = areaTitleRect(area, area.label, area.labelAlign, textScale)
  return (
    <g
      // Interactive only in the editor: the headless export passes no handlers.
      pointerEvents={onStartEdit ? 'all' : 'none'}
      onMouseDown={onStartEdit ? handleMouseDown : undefined}
      onDoubleClick={
        onStartEdit
          ? (e) => {
              e.stopPropagation()
              onStartEdit(area.id)
            }
          : undefined
      }
    >
      <rect
        x={chip.x}
        y={chip.y}
        width={chip.w}
        height={chip.h}
        rx={chip.h / 2}
        ry={chip.h / 2}
        fill='#ffffff'
        stroke={accent}
        strokeWidth={1}
      />
      <text
        x={chip.x + chip.w / 2}
        y={chip.y + chip.h / 2 + 0.5}
        textAnchor='middle'
        dominantBaseline='middle'
        fontFamily={fontFamily}
        fontSize={LABEL_FONT * textScale}
        fontWeight={600}
        fill={accent}
      >
        {area.label}
      </text>
    </g>
  )
}

interface AreaLabelInputProps {
  initialLabel: string
  style: CSSProperties
  /** Plain-text title; an empty string clears the label. */
  onCommit: (label: string) => void
  onCancel: () => void
}

// One-line inline editor overlaid on a title chip. Enter, blur or a mousedown
// outside commits, Escape cancels.
export const AreaLabelInput: FC<AreaLabelInputProps> = ({
  initialLabel,
  style,
  onCommit,
  onCancel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  // Enter/Escape blur, and an outside mousedown may precede that blur: settle once.
  const done = useRef(false)

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    const value = inputRef.current?.value ?? initialLabel
    // Untouched input: no write, so open + dismiss never rewrites the .d2. A text
    // input strips LF/CR, so compare with what it showed, not the raw label.
    if (cancelled.current || value === initialLabel.replace(/[\r\n]/g, '')) onCancel()
    else onCommit(value.trim())
  }, [initialLabel, onCommit, onCancel])

  // Same as NodeLabelEditor: the canvas background's mousedown calls
  // preventDefault, so the input never blurs on a click-away. A capture-phase
  // document listener commits instead.
  useEffect(() => {
    const onDocMouseDown = (event: globalThis.MouseEvent) => {
      const input = inputRef.current
      if (input && event.target instanceof globalThis.Node && !input.contains(event.target)) {
        finish()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [finish])

  return (
    <input
      ref={inputRef}
      className="ep-area-label-input"
      aria-label="Group title"
      autoFocus
      defaultValue={initialLabel}
      style={style}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={finish}
    />
  )
}
