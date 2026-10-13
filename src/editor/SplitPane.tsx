import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'

// The code/canvas split: two panes and a draggable separator. Sizes are
// percentages of the row, clamped so neither pane can be squeezed away, and
// remembered across reloads. Keyboard: arrows nudge, Home/End jump to the
// limits (the WAI-ARIA window-splitter pattern).

const STORAGE_KEY = 'epure:ui:split:v1'
// Where react-resizable-panels (≤ 0.6.0) kept the split: `{"editor":36,"canvas":64}`.
const LEGACY_KEY = 'react-resizable-panels:epure:panels'
const KEY_STEP = 2

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  leftClassName?: string
  rightClassName?: string
  /** Initial left width, in percent of the row. */
  defaultLeft: number
  minLeft: number
  minRight: number
}

const loadLeft = (): number | null => {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    if (saved > 0) return saved
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as { editor?: unknown }
    return typeof legacy?.editor === 'number' ? legacy.editor : null
  } catch {
    return null
  }
}

const saveLeft = (pct: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, pct.toFixed(2))
  } catch {
    // Storage unavailable (private mode, sandboxed embed): the split just won't stick.
  }
}

export const SplitPane = ({
  left,
  right,
  leftClassName = '',
  rightClassName = '',
  defaultLeft,
  minLeft,
  minRight,
}: SplitPaneProps) => {
  const clamp = (pct: number) => Math.min(100 - minRight, Math.max(minLeft, pct))
  const [leftPct, setLeftPct] = useState(() => clamp(loadLeft() ?? defaultLeft))
  const [dragging, setDragging] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  const resizeTo = (pct: number) => {
    const next = clamp(pct)
    setLeftPct(next)
    return next
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current?.getBoundingClientRect()
    if (!dragging || !row || row.width === 0) return
    resizeTo(((e.clientX - row.left) / row.width) * 100)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    saveLeft(leftPct)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target =
      e.key === 'ArrowLeft'
        ? leftPct - KEY_STEP
        : e.key === 'ArrowRight'
          ? leftPct + KEY_STEP
          : e.key === 'Home'
            ? minLeft
            : e.key === 'End'
              ? 100 - minRight
              : null
    if (target === null) return
    e.preventDefault()
    saveLeft(resizeTo(target))
  }

  return (
    <div ref={rowRef} className={dragging ? 'ep-split is-resizing' : 'ep-split'}>
      <div className={leftClassName} style={{ flex: `0 0 ${leftPct}%` }}>
        {left}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable window splitter; <hr> can't take focus or pointer drags. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the code pane"
        aria-valuenow={Math.round(leftPct)}
        aria-valuemin={minLeft}
        aria-valuemax={100 - minRight}
        tabIndex={0}
        className="resize-handle"
        data-separator={dragging ? 'active' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <div className={rightClassName} style={{ flex: '1 1 0', minWidth: 0 }}>
        {right}
      </div>
    </div>
  )
}
