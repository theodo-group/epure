import { useCallback, useRef, type MouseEvent, type ReactNode } from 'react'

import { SHAPE_NAMES, type EdgeDirection, type ShapeName } from '@/parser/ast'
import { makeEdgeId } from '@/layout/elk'
import { useDiagramStore } from '@/store/diagramStore'
import { IconControl } from './IconPicker'
import {
  PALETTE,
  type EndCap,
  type FillColor,
  type LineStyle,
  type PaletteColor,
  type Size,
} from './palette'

const COLORS: PaletteColor[] = [
  'black',
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
]
const FILL_OPTIONS: FillColor[] = ['transparent', 'white', ...COLORS]
const SIZES: Size[] = ['S', 'M', 'L', 'XL']
const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted']
const CAPS: EndCap[] = ['none', 'arrow', 'dot', 'diamond']

// The single shared value across a selection, or `undefined` when the items
// disagree (a "mixed" state — no control is shown as active).
const common = <T,>(values: (T | undefined)[]): T | undefined => {
  if (values.length === 0) return undefined
  const first = values[0]
  return values.every((v) => v === first) ? first : undefined
}

const edgeStyleKey = (edgeId: string) => edgeId.split('#')[0] ?? edgeId

// The cap a given edge end shows when no explicit cap is stored — derived from
// the parsed edge direction, matching the renderer's defaults.
const defaultCapFor = (
  dir: EdgeDirection | undefined,
  end: 'start' | 'end',
): EndCap | undefined => {
  if (!dir) return undefined
  if (end === 'start') return dir === 'backward' || dir === 'bidirectional' ? 'arrow' : 'none'
  return dir === 'forward' || dir === 'bidirectional' ? 'arrow' : 'none'
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="ep-style-row">
    <div className="ep-style-label">{label}</div>
    {children}
  </div>
)

interface SwatchesProps<C extends string> {
  value?: C
  onChange: (color?: C) => void
  /** `solid` shows the line/text colour, `fill` the lighter surface tint. */
  variant: 'solid' | 'fill'
  options: C[]
}

const Swatches = <C extends string>({
  value,
  onChange,
  variant,
  options,
}: SwatchesProps<C>) => (
  <div className="ep-swatches">
    <button
      type="button"
      title="Default"
      className={`ep-swatch ep-swatch-none${value === undefined ? ' active' : ''}`}
      onClick={() => onChange(undefined)}
    >
      <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden>
        <line x1="4" y1="14" x2="14" y2="4" stroke="#dc2626" strokeWidth="1.4" />
      </svg>
    </button>
    {options.map((color) => {
      if (color === 'transparent') {
        return (
          <button
            key="transparent"
            type="button"
            title="Transparent"
            className={`ep-swatch ep-swatch-transparent${value === color ? ' active' : ''}`}
            onClick={() => onChange(color)}
          />
        )
      }
      if (color === 'white') {
        return (
          <button
            key="white"
            type="button"
            title="White"
            className={`ep-swatch${value === color ? ' active' : ''}`}
            style={{
              background: '#ffffff',
              borderColor: 'rgba(0,0,0,0.18)',
            }}
            onClick={() => onChange(color)}
          />
        )
      }
      const entry = PALETTE[color as PaletteColor]
      return (
        <button
          key={color}
          type="button"
          title={color}
          className={`ep-swatch${value === color ? ' active' : ''}`}
          style={{
            background: variant === 'fill' ? entry.fill : entry.solid,
            borderColor: variant === 'fill' ? entry.solid : 'rgba(0,0,0,0.12)',
          }}
          onClick={() => onChange(color)}
        />
      )
    })}
  </div>
)

interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value?: T
  /** Shown as active when nothing is explicitly set (the inherited default). */
  defaultValue?: T
  onChange: (value: T | undefined) => void
}

const Segmented = <T extends string>({
  options,
  value,
  defaultValue,
  onChange,
}: SegmentedProps<T>) => {
  // Highlight whatever the element actually renders with — the explicit value,
  // or the inherited default when nothing is set.
  const effective = value ?? defaultValue
  return (
    <div className="ep-seg" role="group">
      {options.map((opt) => {
        const active = opt.value === effective
        const isExplicit = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            title={isExplicit ? `${opt.title ?? opt.value} (click to reset)` : opt.title ?? opt.value}
            className={`ep-seg-btn${active ? ' active' : ''}`}
            // Picking the default (or re-clicking the explicit value) clears the
            // override so the layout file only stores genuine overrides.
            onClick={() =>
              onChange(isExplicit || opt.value === defaultValue ? undefined : opt.value)
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

const LineIcon = ({ style }: { style: LineStyle }) => (
  <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden>
    <line
      x1="2"
      y1="4"
      x2="22"
      y2="4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeDasharray={
        style === 'dashed' ? '5 3' : style === 'dotted' ? '1.6 3' : undefined
      }
    />
  </svg>
)

const CapIcon = ({ cap, flip }: { cap: EndCap; flip?: boolean }) => {
  const inner = (() => {
    if (cap === 'none')
      return (
        <line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )
    if (cap === 'dot')
      return (
        <>
          <line x1="2" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="18" cy="6" r="3" fill="currentColor" />
        </>
      )
    if (cap === 'diamond')
      return (
        <>
          <line x1="2" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M18 2 L22 6 L18 10 L14 6 Z" fill="currentColor" />
        </>
      )
    return (
      <>
        <line x1="2" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 2 L22 6 L14 10 Z" fill="currentColor" />
      </>
    )
  })()
  return (
    <svg
      width="24"
      height="12"
      viewBox="0 0 24 12"
      aria-hidden
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {inner}
    </svg>
  )
}

const sizeOptions = SIZES.map((s) => ({ value: s, label: s, title: s }))
const lineOptions = LINE_STYLES.map((s) => ({
  value: s,
  label: <LineIcon style={s} />,
  title: s,
}))
const capOptions = (flip?: boolean) =>
  CAPS.map((c) => ({ value: c, label: <CapIcon cap={c} flip={flip} />, title: c }))

const ShapeIcon = ({ shape }: { shape: ShapeName }) => {
  const stroke = 'currentColor'
  const fill = 'none'
  const sw = 1.4
  if (shape === 'cylinder')
    return (
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
        <ellipse cx="11" cy="3" rx="8" ry="2" stroke={stroke} strokeWidth={sw} fill={fill} />
        <path d="M3 3 V11 a8 2 0 0 0 16 0 V3" stroke={stroke} strokeWidth={sw} fill={fill} />
      </svg>
    )
  if (shape === 'person')
    return (
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
        <circle cx="11" cy="4" r="2.4" stroke={stroke} strokeWidth={sw} fill={fill} />
        <path d="M5 13 Q5 7 11 7 Q17 7 17 13" stroke={stroke} strokeWidth={sw} fill={fill} />
      </svg>
    )
  // rectangle (default)
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
      <rect x="3" y="3" width="16" height="8" rx="1.6" ry="1.6" stroke={stroke} strokeWidth={sw} fill={fill} />
    </svg>
  )
}

const shapeOptions = SHAPE_NAMES.map((s) => ({
  value: s,
  label: <ShapeIcon shape={s} />,
  title: s,
}))

export const StylePanel = () => {
  const selectedNodeIds = useDiagramStore((s) => s.selectedNodeIds)
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds)
  const selectedAreaIds = useDiagramStore((s) => s.selectedAreaIds)
  const layout = useDiagramStore((s) => s.layout)
  const parseResult = useDiagramStore((s) => s.parseResult)
  const setNodeStyle = useDiagramStore((s) => s.setNodeStyle)
  const setEdgeStyle = useDiagramStore((s) => s.setEdgeStyle)
  const setAreaStyle = useDiagramStore((s) => s.setAreaStyle)
  const panelPos = useDiagramStore((s) => s.stylePanelPosition)
  const setPanelPos = useDiagramStore((s) => s.setStylePanelPosition)

  const panelRef = useRef<HTMLDivElement | null>(null)

  const startDrag = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // Ignore drags that start on an interactive control inside the header.
      const target = event.target as HTMLElement
      if (target.closest('button, select, input, textarea, [contenteditable]')) return
      const panel = panelRef.current
      if (!panel) return
      const parent = panel.offsetParent as HTMLElement | null
      if (!parent) return
      event.preventDefault()
      const parentRect = parent.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const dx = event.clientX - panelRect.left
      const dy = event.clientY - panelRect.top

      const onMove = (e: globalThis.MouseEvent) => {
        const left = e.clientX - parentRect.left - dx
        const top = e.clientY - parentRect.top - dy
        // Keep the panel fully inside the parent — every edge stays visible.
        const maxLeft = Math.max(0, parent.clientWidth - panelRect.width)
        const maxTop = Math.max(0, parent.clientHeight - panelRect.height)
        setPanelPos({
          left: Math.max(0, Math.min(maxLeft, left)),
          top: Math.max(0, Math.min(maxTop, top)),
        })
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setPanelPos],
  )

  const hasNodes = selectedNodeIds.length > 0
  const hasEdges = selectedEdgeIds.length > 0
  const hasAreas = selectedAreaIds.length > 0
  if (!hasNodes && !hasEdges && !hasAreas) return null

  const nodeStyles = selectedNodeIds
    .map((id) => layout.nodes[id])
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
  const edgeStyles = selectedEdgeIds.map(
    (id) => layout.edges[edgeStyleKey(id)] ?? {},
  )
  const areaStyles = selectedAreaIds.map((id) => layout.areas?.[id] ?? {})

  // Effective default caps come from the parsed edge direction, so a default
  // forward arrow shows the arrow end cap as active.
  let startCapDefault: EndCap | undefined
  let endCapDefault: EndCap | undefined
  if (hasEdges) {
    const dirById = parseResult.ok
      ? new Map(
          parseResult.diagram.edges.map(
            (e, i) => [makeEdgeId(e.source, e.target, i), e.direction] as const,
          ),
        )
      : new Map<string, EdgeDirection>()
    startCapDefault = common(
      selectedEdgeIds.map((id) => defaultCapFor(dirById.get(id), 'start')),
    )
    endCapDefault = common(
      selectedEdgeIds.map((id) => defaultCapFor(dirById.get(id), 'end')),
    )
  }

  const astShapeFor = new Map<string, ShapeName>()
  if (hasNodes && parseResult.ok) {
    for (const n of parseResult.diagram.nodes) astShapeFor.set(n.id, n.shape)
  }

  const kindCount = [hasNodes, hasEdges, hasAreas].filter(Boolean).length
  const showHeaders = kindCount > 1

  const summaryParts: string[] = []
  if (hasNodes)
    summaryParts.push(
      `${selectedNodeIds.length} ${selectedNodeIds.length === 1 ? 'node' : 'nodes'}`,
    )
  if (hasEdges)
    summaryParts.push(
      `${selectedEdgeIds.length} ${selectedEdgeIds.length === 1 ? 'edge' : 'edges'}`,
    )
  if (hasAreas)
    summaryParts.push(
      `${selectedAreaIds.length} ${selectedAreaIds.length === 1 ? 'group' : 'groups'}`,
    )

  const panelStyle = panelPos
    ? { top: panelPos.top, left: panelPos.left, right: 'auto' as const }
    : undefined

  return (
    <div
      ref={panelRef}
      className="ep-style-panel"
      role="group"
      aria-label="Style"
      style={panelStyle}
    >
      <div
        className="ep-style-head ep-style-drag"
        onMouseDown={startDrag}
        title="Drag to move"
      >
        <span>{summaryParts.join(' · ')}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <circle cx="5" cy="4" r="1" fill="currentColor" />
          <circle cx="11" cy="4" r="1" fill="currentColor" />
          <circle cx="5" cy="8" r="1" fill="currentColor" />
          <circle cx="11" cy="8" r="1" fill="currentColor" />
          <circle cx="5" cy="12" r="1" fill="currentColor" />
          <circle cx="11" cy="12" r="1" fill="currentColor" />
        </svg>
      </div>

      {hasNodes ? (
        <section className="ep-style-section">
          {showHeaders ? <div className="ep-style-kind">Node</div> : null}
          <Row label="Shape">
            <Segmented
              options={shapeOptions}
              value={common(nodeStyles.map((n) => n.shape))}
              defaultValue={
                common(
                  selectedNodeIds.map(
                    (id) => astShapeFor.get(id),
                  ),
                ) ?? 'rectangle'
              }
              onChange={(v) => setNodeStyle({ shape: v })}
            />
          </Row>
          <Row label="Icon">
            <IconControl
              value={common(nodeStyles.map((n) => n.icon))}
              mixed={new Set(nodeStyles.map((n) => n.icon)).size > 1}
              onChange={(id) => setNodeStyle({ icon: id })}
            />
          </Row>
          {nodeStyles.some((n) => n.icon) ? (
            <Row label="Icon position">
              <Segmented
                options={[
                  { value: 'corner', label: 'Corner', title: 'Bottom-right badge' },
                  { value: 'top', label: 'Top', title: 'Centered above the label' },
                ]}
                value={common(nodeStyles.map((n) => n.iconPosition))}
                defaultValue="corner"
                onChange={(v) => setNodeStyle({ iconPosition: v })}
              />
            </Row>
          ) : null}
          <Row label="Text size">
            <Segmented
              options={sizeOptions}
              value={common(nodeStyles.map((n) => n.textSize))}
              defaultValue="M"
              onChange={(v) => setNodeStyle({ textSize: v })}
            />
          </Row>
          <Row label="Text color">
            <Swatches
              variant="solid"
              options={COLORS}
              value={common(nodeStyles.map((n) => n.textColor))}
              onChange={(c) => setNodeStyle({ textColor: c })}
            />
          </Row>
          <Row label="Border color">
            <Swatches
              variant="solid"
              options={COLORS}
              value={common(nodeStyles.map((n) => n.borderColor))}
              onChange={(c) => setNodeStyle({ borderColor: c })}
            />
          </Row>
          <Row label="Border style">
            <Segmented
              options={lineOptions}
              value={common(nodeStyles.map((n) => n.borderStyle))}
              defaultValue="solid"
              onChange={(v) => setNodeStyle({ borderStyle: v })}
            />
          </Row>
          <Row label="Fill">
            <Swatches
              variant="fill"
              options={FILL_OPTIONS}
              value={common(nodeStyles.map((n) => n.fillColor))}
              onChange={(c) => setNodeStyle({ fillColor: c })}
            />
          </Row>
        </section>
      ) : null}

      {hasEdges ? (
        <section className="ep-style-section">
          {showHeaders ? <div className="ep-style-kind">Edge</div> : null}
          <Row label="Color">
            <Swatches
              variant="solid"
              options={COLORS}
              value={common(edgeStyles.map((e) => e.color))}
              onChange={(c) => setEdgeStyle({ color: c })}
            />
          </Row>
          <Row label="Width">
            <Segmented
              options={sizeOptions}
              value={common(edgeStyles.map((e) => e.width))}
              defaultValue="M"
              onChange={(v) => setEdgeStyle({ width: v })}
            />
          </Row>
          <Row label="Line style">
            <Segmented
              options={lineOptions}
              value={common(edgeStyles.map((e) => e.lineStyle))}
              defaultValue="solid"
              onChange={(v) => setEdgeStyle({ lineStyle: v })}
            />
          </Row>
          <Row label="Start cap">
            <Segmented
              options={capOptions(true)}
              value={common(edgeStyles.map((e) => e.startCap))}
              defaultValue={startCapDefault}
              onChange={(v) => setEdgeStyle({ startCap: v })}
            />
          </Row>
          <Row label="End cap">
            <Segmented
              options={capOptions()}
              value={common(edgeStyles.map((e) => e.endCap))}
              defaultValue={endCapDefault}
              onChange={(v) => setEdgeStyle({ endCap: v })}
            />
          </Row>
        </section>
      ) : null}

      {hasAreas ? (
        <section className="ep-style-section">
          {showHeaders ? <div className="ep-style-kind">Group</div> : null}
          <Row label="Border color">
            <Swatches
              variant="solid"
              options={COLORS}
              value={common(areaStyles.map((a) => a.borderColor))}
              onChange={(c) => setAreaStyle({ borderColor: c })}
            />
          </Row>
          <Row label="Border style">
            <Segmented
              options={lineOptions}
              value={common(areaStyles.map((a) => a.borderStyle))}
              defaultValue="dashed"
              onChange={(v) => setAreaStyle({ borderStyle: v })}
            />
          </Row>
          <Row label="Fill">
            <Swatches
              variant="fill"
              options={FILL_OPTIONS}
              value={common(areaStyles.map((a) => a.fillColor))}
              onChange={(c) => setAreaStyle({ fillColor: c })}
            />
          </Row>
        </section>
      ) : null}
    </div>
  )
}
