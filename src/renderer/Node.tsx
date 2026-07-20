import { useCallback, useRef, type FC, type MouseEvent } from 'react'

import type { ShapeName } from '@/parser/ast'
import type { Side } from '@/layout/types'
import type { FillColor, LineStyle, PaletteColor, Size } from '@/style/palette'
import { iconUrlById } from '@/icons'
import {
  dashArrayFor,
  resolveFill,
  solidOf,
  TEXT_SIZE,
} from '@/style/palette'

import { beginDrag, endDrag } from './dragState'
import {
  hasRichMarkup,
  parseRichText,
  wrapRichText,
  type RichLine,
} from './richText'

import {
  Cylinder,
  Person,
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
  icon?: string
  iconPosition?: 'corner' | 'top'
  onSelect?: (id: string, additive: boolean) => void
  onMove?: (id: string, centerX: number, centerY: number, shiftKey: boolean) => void
  onResize?: (id: string, side: Side, pxX: number, pxY: number) => void
  /** Double-click to edit this node's label inline. */
  onStartEdit?: (id: string) => void
  /** When true this node's label is being edited in the overlay editor, so the
   *  baked SVG label is suppressed to avoid rendering it twice. */
  editing?: boolean
  gridSize: number
  textScale?: number
  fontFamily?: string
}

const SHAPE_COMPONENTS: Record<ShapeName, FC<ShapeProps>> = {
  rectangle: Rectangle,
  cylinder: Cylinder,
  person: Person,
}

const AVG_CHAR_PX = 6.6
const RESIZE_HANDLE = 8
const LINE_HEIGHT = 14
// Breathing room between a person figure's bottom edge and its label, which
// renders below the shape instead of inside it. Scaled with the global text.
const LABEL_BELOW_GAP = 8

// Word-wrap a plain string by approximate character width; matches the
// previous behaviour for labels without any markup.
const wrapPlain = (label: string, w: number): RichLine[] => {
  const maxChars = Math.max(4, Math.floor((w - 16) / AVG_CHAR_PX))
  return wrapRichText([{ words: label.split(/\s+/).filter(Boolean).map((t) => ({ text: t })) }], maxChars)
}

const wrapRich = (label: string, w: number): RichLine[] => {
  const maxChars = Math.max(4, Math.floor((w - 16) / AVG_CHAR_PX))
  return wrapRichText(parseRichText(label), maxChars)
}

const isLineEmpty = (line: RichLine): boolean =>
  line.words.length === 0 || line.words.every((wd) => !wd.text)

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
  icon,
  iconPosition,
  onSelect,
  onMove,
  onResize,
  onStartEdit,
  editing,
  gridSize,
  textScale = 1,
  fontFamily = 'Inter, system-ui, sans-serif',
}) => {
  const Shape = SHAPE_COMPONENTS[shape] ?? Rectangle
  const strokeColor = borderColor ? solidOf(borderColor) : '#475569'
  // `transparent` keeps the interior see-through but still hit-testable (unlike
  // `none`), so the node stays clickable/draggable by its whole body.
  const shapeFill = resolveFill(fillColor) ?? '#ffffff'
  const dash = borderStyle ? dashArrayFor(borderStyle, 1.5) : undefined
  const fontSize = TEXT_SIZE[textSize ?? 'M'] * textScale
  const lineHeight = LINE_HEIGHT * textScale
  const labelFill = textColor ? solidOf(textColor) : '#1f2430'
  // Person shape fills its whole bounding box with a figure; render the
  // label below the figure instead of overlaying it.
  const labelBelow = shape === 'person'

  // An icon, when present, renders either as a corner badge or centered at
  // the top, depending on `iconPosition`. The person figure already reads as
  // an icon, so skip icons there.
  const iconUrl = icon && shape !== 'person' ? iconUrlById(icon) : undefined
  const effectiveIconPos = iconPosition ?? 'corner'

  // Corner badge: peeks past the bottom-right corner by 1/6 of its size, so
  // most of the badge sits inside the node and the overhang stays well clear
  // of any parent area's padding. Skipped on near-degenerate nodes where it
  // can't read. Cylinders have a curl at the bottom (height ≈ 9.6px) that
  // their bounding box covers but the visible body doesn't — anchor the badge
  // to the visible body so it doesn't float in the curl's empty space.
  const badge =
    iconUrl && effectiveIconPos === 'corner' && Math.min(w, h) >= 22
      ? (() => {
          const size = Math.min(Math.min(w, h) * 0.54, 66)
          const cylinderLift = shape === 'cylinder' ? Math.min(h * 0.12, 12) : 0
          return {
            cx: x + w - size / 3,
            cy: y + h - size / 3 - cylinderLift,
            size,
          }
        })()
      : null

  // Top icon: centered horizontally, nested fully inside the shape with a
  // small top padding. Sized to leave room for at least one line of label.
  const topIcon =
    iconUrl && effectiveIconPos === 'top' && Math.min(w, h) >= 28
      ? (() => {
          const size = Math.max(20, Math.min(Math.min(w * 0.45, h * 0.42), 56))
          const topPad = Math.max(8, Math.min(14, h * 0.14))
          return {
            cx: x + w / 2,
            cy: y + topPad + size / 2,
            size,
            bottom: y + topPad + size,
          }
        })()
      : null

  // Lay out the label. Corner badges reserve a bit of right margin; top icons
  // push the label down below the icon and use the full width. Wrapping widths
  // are divided by textScale so larger global text wraps proportionally sooner.
  const textWidth = (badge ? w - 14 : w) / textScale
  const labelBelowWidth = (w * 2) / textScale
  const rich = label
    ? hasRichMarkup(label)
      ? wrapRich(label, labelBelow ? labelBelowWidth : textWidth)
      : wrapPlain(label, labelBelow ? labelBelowWidth : textWidth)
    : []
  const blockH = rich.length * lineHeight

  let startY: number
  if (labelBelow) {
    startY = y + h + lineHeight + LABEL_BELOW_GAP * textScale
  } else if (topIcon) {
    // Center the label block in the leftover area below the icon.
    const availTop = topIcon.bottom + 4
    const availBottom = y + h - 2
    const center = (availTop + availBottom) / 2
    startY = Math.max(availTop + lineHeight * 0.8, center - blockH / 2 + lineHeight * 0.8)
  } else {
    const textCenterY = y + h / 2
    // Clamp the first baseline so a tall label never escapes the top edge.
    startY = Math.max(y + lineHeight * 0.8, textCenterY - blockH / 2 + lineHeight * 0.8)
  }

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
      onDoubleClick={
        onStartEdit
          ? (event) => {
              event.stopPropagation()
              event.preventDefault()
              onStartEdit(id)
            }
          : undefined
      }
      style={{ cursor: onMove ? 'grab' : 'pointer' }}
    >
      <g filter='url(#ep-node-shadow)'>
        <Shape
          x={x}
          y={y}
          w={w}
          h={h}
          fill={shapeFill}
          stroke={strokeColor}
          strokeDasharray={dash}
        />
      </g>
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
      {badge ? (
        (() => {
          const s = badge.size
          const bx = badge.cx - s / 2
          const by = badge.cy - s / 2
          const rad = s * 0.24
          const iconS = s * 0.68
          return (
            <g pointerEvents='none'>
              {/* Soft drop shadow tinted with the node's border colour. */}
              <rect
                x={bx}
                y={by + 1.5}
                width={s}
                height={s}
                rx={rad}
                ry={rad}
                fill={strokeColor}
                opacity={0.45}
                filter='url(#ep-badge-shadow)'
              />
              {/* Chip behind the logo. Picks up the node's effective fill so
                  the badge reads as part of the node when the user has chosen
                  a coloured fill; defaults to white on white/transparent
                  nodes so the logo still reads against the body. */}
              <rect
                x={bx}
                y={by}
                width={s}
                height={s}
                rx={rad}
                ry={rad}
                fill={shapeFill === 'transparent' ? '#ffffff' : shapeFill}
                stroke='#e7e5e4'
                strokeWidth={1}
              />
              <image
                href={iconUrl}
                x={badge.cx - iconS / 2}
                y={badge.cy - iconS / 2}
                width={iconS}
                height={iconS}
                preserveAspectRatio='xMidYMid meet'
              />
            </g>
          )
        })()
      ) : null}
      {topIcon ? (
        <g pointerEvents='none'>
          {/* Soft white halo behind the icon: a circle blurred via
              ep-icon-halo so the icon fades smoothly into the node body
              and any underlying strokes (e.g. the cylinder top arc) read
              as receding into the background rather than cutting across
              the icon. */}
          <circle
            cx={topIcon.cx}
            cy={topIcon.cy}
            r={topIcon.size * 0.62}
            fill={shapeFill === 'transparent' ? '#ffffff' : shapeFill}
            filter='url(#ep-icon-halo)'
          />
          <image
            href={iconUrl}
            x={topIcon.cx - topIcon.size / 2}
            y={topIcon.cy - topIcon.size / 2}
            width={topIcon.size}
            height={topIcon.size}
            preserveAspectRatio='xMidYMid meet'
          />
        </g>
      ) : null}
      {!editing && rich.map((line, i) => {
        if (isLineEmpty(line)) {
          // Preserve vertical spacing for explicit blank lines without
          // emitting an empty <text> element.
          return null
        }
        return (
          <text
            key={i}
            x={x + w / 2}
            y={startY + i * lineHeight}
            textAnchor='middle'
            fontFamily={fontFamily}
            fontSize={fontSize}
            fill={labelFill}
            pointerEvents='none'
          >
            {line.bullet ? <tspan>{'• '}</tspan> : null}
            {line.words.map((wd, j) => {
              const weight = wd.bold ? 700 : undefined
              const style = wd.italic ? 'italic' : undefined
              const sz = wd.small ? Math.max(9, fontSize - 2) : undefined
              const opacity = wd.small ? 0.7 : undefined
              return (
                <tspan
                  key={j}
                  fontWeight={weight}
                  fontStyle={style}
                  fontSize={sz}
                  opacity={opacity}
                >
                  {(j > 0 ? ' ' : '') + wd.text}
                </tspan>
              )
            })}
          </text>
        )
      })}
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
