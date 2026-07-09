import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import { editorHtmlToLabel, labelToEditorHtml } from '@/editor/labelMarkup'

export interface NodeLabelEditorProps {
  /** Current label markup (D2 subset) to seed the editor with. */
  initialLabel: string
  /** Editor box in canvas-pane pixels (mirrors the node's on-screen rect). */
  left: number
  top: number
  width: number
  height: number
  /** Presentation, matched to how the node's label renders. */
  fontSize: number
  fontFamily: string
  color: string
  background: string
  /** Commit the edited markup (empty string clears the label). */
  onCommit: (markup: string) => void
  /** Abandon the edit, leaving the label unchanged. */
  onCancel: () => void
}

type FormatState = { bold: boolean; italic: boolean; small: boolean; list: boolean }

const MIN_W = 96
const MIN_H = 34
// Below this the toolbar would clip past the top of the canvas — flip it under.
const TOOLBAR_FLIP_Y = 48

// Walk up from the selection's focus to see if it sits inside a tag we care
// about — used both for toggling <small> and for lighting up toolbar buttons.
const selectionAncestor = (
  root: HTMLElement,
  tagNames: string[],
): HTMLElement | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.getRangeAt(0).commonAncestorContainer
  while (node && node !== root) {
    if (
      node.nodeType === 1 &&
      tagNames.includes((node as HTMLElement).tagName.toLowerCase())
    ) {
      return node as HTMLElement
    }
    node = node.parentNode
  }
  return null
}

// Lift an element's children into its place and remove it. Returns the first
// and last lifted nodes so the caller can re-select the same run (unwrapping
// otherwise collapses the selection).
const unwrap = (el: HTMLElement): { first: Node | null; last: Node | null } => {
  const parent = el.parentNode
  if (!parent) return { first: null, last: null }
  const first = el.firstChild
  const last = el.lastChild
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
  return { first, last }
}

// Swallow mousedown so a toolbar click never blurs the editable (which would
// commit) nor bubbles into the canvas.
const swallow = (event: ReactMouseEvent) => event.preventDefault()

const ToolButton = ({
  label,
  active,
  onActivate,
  children,
}: {
  label: string
  active?: boolean
  onActivate: () => void
  children: ReactNode
}) => (
  <button
    type="button"
    className={`ep-label-tool ${active ? 'active' : ''}`}
    title={label}
    aria-label={label}
    aria-pressed={active}
    onMouseDown={swallow}
    onClick={onActivate}
  >
    {children}
  </button>
)

export const NodeLabelEditor = ({
  initialLabel,
  left,
  top,
  width,
  height,
  fontSize,
  fontFamily,
  color,
  background,
  onCommit,
  onCancel,
}: NodeLabelEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const editableRef = useRef<HTMLDivElement>(null)
  // Guards the commit/cancel handlers so an unmount-triggered blur can't fire a
  // second write after the user already committed.
  const doneRef = useRef(false)
  const [fmt, setFmt] = useState<FormatState>({
    bold: false,
    italic: false,
    small: false,
    list: false,
  })

  const refreshFormatState = useCallback(() => {
    const root = editableRef.current
    if (!root) return
    let bold = false
    let italic = false
    let list = false
    try {
      bold = document.queryCommandState('bold')
      italic = document.queryCommandState('italic')
      list = document.queryCommandState('insertUnorderedList')
    } catch {
      // queryCommandState can throw when there's no live selection.
    }
    const small = !!selectionAncestor(root, ['small'])
    setFmt({ bold, italic, small, list })
  }, [])

  // Seed the editable once, focus it, and select all so typing replaces the
  // label (the familiar rename gesture) while formatting still works per-run.
  useEffect(() => {
    const root = editableRef.current
    if (!root) return
    root.innerHTML = labelToEditorHtml(initialLabel)
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      // Non-fatal: some engines format with CSS spans regardless; the
      // serializer recovers bold/italic from inline styles.
    }
    root.focus()
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(root)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    refreshFormatState()
    // Seed strictly on mount; later prop changes must not clobber the buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    const root = editableRef.current
    onCommit(root ? editorHtmlToLabel(root) : '')
  }, [onCommit])

  // Commit when the user mouses down anywhere outside the editor. `onBlur`
  // alone isn't enough: the canvas background's mousedown calls preventDefault
  // (to suppress focus-shift for its marquee/pan gesture), which also prevents
  // the editable from blurring — so a plain "click away to finish" would never
  // fire onBlur. A capture-phase document listener sidesteps that; it doesn't
  // stopPropagation, so clicking another node still selects/edits it normally.
  useEffect(() => {
    const onDocMouseDown = (event: globalThis.MouseEvent) => {
      const container = containerRef.current
      if (
        container &&
        event.target instanceof globalThis.Node &&
        !container.contains(event.target)
      ) {
        commit()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [commit])

  const cancel = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }, [onCancel])

  const exec = useCallback(
    (command: string) => {
      editableRef.current?.focus()
      try {
        document.execCommand(command)
      } catch {
        // Ignore unsupported command; the editor stays usable.
      }
      refreshFormatState()
    },
    [refreshFormatState],
  )

  // Toggle <small> over the current selection. execCommand has no equivalent,
  // so wrap/unwrap by hand.
  const toggleSmall = useCallback(() => {
    const root = editableRef.current
    if (!root) return
    root.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const existing = selectionAncestor(root, ['small'])
    if (existing) {
      const { first, last } = unwrap(existing)
      // Keep the text selected after unwrapping so the user can toggle again or
      // apply another format without re-selecting.
      if (first && last) {
        sel.removeAllRanges()
        const restored = document.createRange()
        restored.setStartBefore(first)
        restored.setEndAfter(last)
        sel.addRange(restored)
      }
    } else {
      const range = sel.getRangeAt(0)
      if (range.collapsed) return
      const frag = range.extractContents()
      const el = document.createElement('small')
      el.appendChild(frag)
      range.insertNode(el)
      sel.removeAllRanges()
      const after = document.createRange()
      after.selectNodeContents(el)
      sel.addRange(after)
    }
    refreshFormatState()
  }, [refreshFormatState])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
      }
      if (event.key === 'Enter') {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          commit()
          return
        }
        // Inside a list, let the browser create the next <li>. Otherwise force a
        // <br> so line breaks are consistent across engines (Chrome would
        // otherwise wrap the new line in a <div>).
        if (!selectionAncestor(editableRef.current!, ['li'])) {
          event.preventDefault()
          document.execCommand('insertLineBreak')
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const k = event.key.toLowerCase()
        if (k === 'b') {
          event.preventDefault()
          exec('bold')
        } else if (k === 'i') {
          event.preventDefault()
          exec('italic')
        }
      }
    },
    [cancel, commit, exec],
  )

  // Keep the box vertically centered on the node as it grows with content.
  const boxH = Math.max(MIN_H, height)
  const boxW = Math.max(MIN_W, width)
  const boxTop = top - (boxH - height) / 2
  const boxLeft = left - (boxW - width) / 2
  const toolbarBelow = boxTop < TOOLBAR_FLIP_Y

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: boxLeft,
    top: boxTop,
    width: boxW,
    minHeight: boxH,
  }

  const editableStyle: CSSProperties = {
    minHeight: boxH,
    fontSize: Math.max(11, fontSize),
    fontFamily,
    color,
    background,
    lineHeight: 1.25,
  }

  return (
    <div ref={containerRef} className="ep-label-editor" style={containerStyle}>
      <div
        className={`ep-label-toolbar ${toolbarBelow ? 'below' : ''}`}
        onMouseDown={swallow}
        role="toolbar"
        aria-label="Format label"
      >
        <ToolButton label="Bold (⌘B)" active={fmt.bold} onActivate={() => exec('bold')}>
          <span style={{ fontWeight: 700 }}>B</span>
        </ToolButton>
        <ToolButton
          label="Italic (⌘I)"
          active={fmt.italic}
          onActivate={() => exec('italic')}
        >
          <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</span>
        </ToolButton>
        <ToolButton label="Small" active={fmt.small} onActivate={toggleSmall}>
          <span style={{ fontSize: 10, fontWeight: 600 }}>S</span>
        </ToolButton>
        <ToolButton
          label="Bulleted list"
          active={fmt.list}
          onActivate={() => exec('insertUnorderedList')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="3" cy="4" r="1.3" fill="currentColor" />
            <circle cx="3" cy="8" r="1.3" fill="currentColor" />
            <circle cx="3" cy="12" r="1.3" fill="currentColor" />
            <path
              d="M6.5 4H14M6.5 8H14M6.5 12H14"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </ToolButton>
        <span className="ep-label-tool-sep" />
        <ToolButton label="Done (⌘↵)" onActivate={commit}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolButton>
      </div>
      <div
        ref={editableRef}
        className="ep-label-editable"
        style={editableStyle}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onInput={refreshFormatState}
        onMouseUp={refreshFormatState}
        onKeyUp={refreshFormatState}
      />
    </div>
  )
}
