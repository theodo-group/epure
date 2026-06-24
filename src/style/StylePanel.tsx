import type { ReactNode } from 'react'

import { useDiagramStore } from '@/store/diagramStore'
import {
  PALETTE,
  type EndCap,
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

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="ag-style-row">
    <div className="ag-style-label">{label}</div>
    {children}
  </div>
)

interface SwatchesProps {
  value?: PaletteColor
  onChange: (color?: PaletteColor) => void
  /** `solid` shows the line/text colour, `fill` the lighter surface tint. */
  variant: 'solid' | 'fill'
}

const Swatches = ({ value, onChange, variant }: SwatchesProps) => (
  <div className="ag-swatches">
    <button
      type="button"
      title="Default"
      className={`ag-swatch ag-swatch-none${value === undefined ? ' active' : ''}`}
      onClick={() => onChange(undefined)}
    >
      <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden>
        <line x1="4" y1="14" x2="14" y2="4" stroke="#dc2626" strokeWidth="1.4" />
      </svg>
    </button>
    {COLORS.map((color) => {
      const entry = PALETTE[color]
      return (
        <button
          key={color}
          type="button"
          title={color}
          className={`ag-swatch${value === color ? ' active' : ''}`}
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
  /** Highlighted faintly when nothing is set, to show the inherited default. */
  defaultValue?: T
  onChange: (value: T | undefined) => void
}

const Segmented = <T extends string>({
  options,
  value,
  defaultValue,
  onChange,
}: SegmentedProps<T>) => (
  <div className="ag-seg" role="group">
    {options.map((opt) => {
      const active = value === opt.value
      const ghost = value === undefined && defaultValue === opt.value
      return (
        <button
          key={opt.value}
          type="button"
          title={active ? `${opt.title ?? opt.value} (click to reset)` : opt.title ?? opt.value}
          className={`ag-seg-btn${active ? ' active' : ''}${ghost ? ' ghost' : ''}`}
          // Clicking the active option clears the override back to the
          // inherited default (mirrors the swatch "Default" affordance).
          onClick={() => onChange(active ? undefined : opt.value)}
        >
          {opt.label}
        </button>
      )
    })}
  </div>
)

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

export const StylePanel = () => {
  const selectedNodeIds = useDiagramStore((s) => s.selectedNodeIds)
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds)
  const selectedAreaIds = useDiagramStore((s) => s.selectedAreaIds)
  const layout = useDiagramStore((s) => s.layout)
  const setNodeStyle = useDiagramStore((s) => s.setNodeStyle)
  const setEdgeStyle = useDiagramStore((s) => s.setEdgeStyle)
  const setAreaStyle = useDiagramStore((s) => s.setAreaStyle)

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

  return (
    <div className="ag-style-panel" role="group" aria-label="Style">
      <div className="ag-style-head">{summaryParts.join(' · ')}</div>

      {hasNodes ? (
        <section className="ag-style-section">
          {showHeaders ? <div className="ag-style-kind">Node</div> : null}
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
              value={common(nodeStyles.map((n) => n.textColor))}
              onChange={(c) => setNodeStyle({ textColor: c })}
            />
          </Row>
          <Row label="Border color">
            <Swatches
              variant="solid"
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
              value={common(nodeStyles.map((n) => n.fillColor))}
              onChange={(c) => setNodeStyle({ fillColor: c })}
            />
          </Row>
        </section>
      ) : null}

      {hasEdges ? (
        <section className="ag-style-section">
          {showHeaders ? <div className="ag-style-kind">Edge</div> : null}
          <Row label="Color">
            <Swatches
              variant="solid"
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
              onChange={(v) => setEdgeStyle({ startCap: v })}
            />
          </Row>
          <Row label="End cap">
            <Segmented
              options={capOptions()}
              value={common(edgeStyles.map((e) => e.endCap))}
              onChange={(v) => setEdgeStyle({ endCap: v })}
            />
          </Row>
        </section>
      ) : null}

      {hasAreas ? (
        <section className="ag-style-section">
          {showHeaders ? <div className="ag-style-kind">Group</div> : null}
          <Row label="Border color">
            <Swatches
              variant="solid"
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
              value={common(areaStyles.map((a) => a.fillColor))}
              onChange={(c) => setAreaStyle({ fillColor: c })}
            />
          </Row>
        </section>
      ) : null}
    </div>
  )
}
