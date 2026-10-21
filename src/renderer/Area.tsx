import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type MouseEvent,
} from 'react'

import { areaTitleRect, areaTitleScale } from '@/layout/areaTitle'
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
  /** Live text zoom, so the title hit target matches the drawn chip. */
  textScale?: number
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

export const Area: FC<AreaProps> = ({ area, selected, textScale = 1, ...pointer }) => {
  const handleMouseDown = useAreaMouseDown(area.id, pointer)
  const { onDragMove, onStartEdit } = pointer
  // The visible chip (AreaLabel) is painted above nodes and edges and lets
  // pointer events through; this transparent twin sits in the area's own layer,
  // so the chip grabs the group only where nothing else is on top of it.
  const chip =
    onStartEdit && area.label ? areaTitleRect(area, area.label, area.labelAlign, textScale) : null
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
      {chip ? (
        <rect
          data-area-title-hit
          x={chip.x}
          y={chip.y}
          width={chip.w}
          height={chip.h}
          rx={chip.h / 2}
          fill="transparent"
          pointerEvents="all"
        />
      ) : null}
      {selected ? (
        <rect
          x={area.x - 4}
          y={area.y - 4}
          width={area.w + 8}
          height={area.h + 8}
          rx={16}
          ry={16}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      ) : null}
    </g>
  )
}

export const AREA_LABEL_FONT = 12
export const AREA_LABEL_FONT_FAMILY = 'Inter, system-ui, sans-serif'

// Title color: the area's border color, else a neutral slate.
export const areaAccent = (area: Pick<AreaLayout, 'borderColor'>): string =>
  area.borderColor ? solidOf(area.borderColor) : '#5b6478'

interface AreaLabelProps {
  area: AreaLayout
  textScale?: number
  fontFamily?: string
}

// Purely visual: painted above nodes and edges so the title stays legible, but
// pointer events fall through to whatever lies beneath (see Area's hit target).
export const AreaLabel: FC<AreaLabelProps> = ({
  area,
  textScale = 1,
  fontFamily = AREA_LABEL_FONT_FAMILY,
}) => {
  if (!area.label) return null
  const accent = areaAccent(area)
  const chip = areaTitleRect(area, area.label, area.labelAlign, textScale)
  const scale = areaTitleScale(area.w, area.label, textScale)
  return (
    <g pointerEvents="none">
      <rect
        x={chip.x}
        y={chip.y}
        width={chip.w}
        height={chip.h}
        rx={chip.h / 2}
        ry={chip.h / 2}
        fill="#ffffff"
        stroke={accent}
        strokeWidth={1}
      />
      <text
        x={chip.x + chip.w / 2}
        y={chip.y + chip.h / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily={fontFamily}
        fontSize={AREA_LABEL_FONT * scale}
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
  /** Plain-text title; an empty string clears the label. Return false when
   *  the title could not be saved: the editor then stays open with the text. */
  onCommit: (label: string) => boolean
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
  const [rejected, setRejected] = useState(false)
  // The parent passes fresh callbacks on every render; read them through a ref
  // so `finish` (and the document listener below) stays stable while editing.
  const callbacks = useRef({ onCommit, onCancel })
  callbacks.current = { onCommit, onCancel }

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    const value = inputRef.current?.value ?? initialLabel
    // Untouched input: no write, so open + dismiss never rewrites the .d2. A text
    // input strips LF/CR, so compare with what it showed, not the raw label.
    if (cancelled.current || value === initialLabel.replace(/[\r\n]/g, '')) {
      callbacks.current.onCancel()
    } else if (callbacks.current.onCommit(value.trim()) === false) {
      // Not saved (e.g. the .d2 doesn't parse right now): keep the typed title
      // and the editor, so nothing is lost; the next Enter or click-away retries
      // and Escape still dismisses it.
      done.current = false
      setRejected(true)
    }
  }, [initialLabel])

  useEffect(() => inputRef.current?.focus(), [])

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
      aria-invalid={rejected || undefined}
      title={rejected ? 'Fix the .d2 errors to save this title, or press Escape' : undefined}
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
