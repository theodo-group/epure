import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  Decoration,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  type LanguageSupport,
} from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { d2Support } from './d2-language'
import type { ParseError } from '@/parser/ast'

export interface CodeMirrorPaneHandle {
  scrollToLine: (line: number) => void
  openSearch: () => void
  /** Apply a set of selection highlights (canvas selection mirrored into the
   *  editor as line + range decorations). Pass an empty array to clear. */
  highlightRanges: (
    ranges: ReadonlyArray<{ from: number; to: number }>,
  ) => void
}

export interface CodeMirrorPaneProps {
  value: string
  onChange: (value: string) => void
  errors?: ParseError[]
  language?: LanguageSupport
}

/**
 * Narrow an external value update to just the span that actually changed, by
 * peeling off the common prefix and suffix. Replacing the whole document (from
 * 0 to end) instead collapses the selection to the top — so a remote edit that
 * touches one line elsewhere would yank the user's cursor to line 1. Dispatching
 * only the differing middle lets CodeMirror map the selection through the change,
 * keeping the caret put whenever the edit doesn't straddle it.
 */
export const minimalDocChange = (
  current: string,
  next: string,
): { from: number; to: number; insert: string } => {
  const maxLen = Math.min(current.length, next.length)
  let from = 0
  while (from < maxLen && current.charCodeAt(from) === next.charCodeAt(from)) {
    from++
  }
  // Common suffix, but never overlapping the shared prefix on either string.
  let suffix = 0
  const maxSuffix = maxLen - from
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++
  }
  return {
    from,
    to: current.length - suffix,
    insert: next.slice(from, next.length - suffix),
  }
}

// Surface parser errors directly in the editor: a highlighted line, a wavy
// underline on the offending range, and the message rendered inline at the end
// of the line. We don't pull the full lint package because the parser already
// gives us authoritative errors.
const setErrors = StateEffect.define<ParseError[]>()

const errorLineDeco = Decoration.line({
  attributes: { class: 'cm-epure-error-line' },
})

const errorMarkDeco = Decoration.mark({ class: 'cm-epure-error-mark' })

class ErrorMessageWidget extends WidgetType {
  constructor(readonly message: string) {
    super()
  }
  override eq(other: ErrorMessageWidget) {
    return other.message === this.message
  }
  override toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-epure-error-msg'
    span.textContent = this.message
    return span
  }
  override ignoreEvent() {
    return true
  }
}

// Mirror the canvas selection into the editor: highlight the line(s) of each
// selected node/edge/area, and underline the exact declaration range. Kept
// separate from the error field so the two layers can coexist.
const setSelectionHighlights = StateEffect.define<
  ReadonlyArray<{ from: number; to: number }>
>()

const selectionLineDeco = Decoration.line({
  attributes: { class: 'cm-epure-sel-line' },
})

const selectionMarkDeco = Decoration.mark({ class: 'cm-epure-sel-mark' })

const selectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setSelectionHighlights)) {
        const doc = tr.state.doc
        const decos = []
        const stampedLines = new Set<number>()
        for (const { from, to } of e.value) {
          // A non-finite endpoint would poison the clamps below into NaN and
          // crash `doc.lineAt(NaN)`; skip such ranges rather than render them.
          if (!Number.isFinite(from) || !Number.isFinite(to)) continue
          const safeFrom = Math.max(0, Math.min(doc.length, from))
          const safeTo = Math.max(safeFrom, Math.min(doc.length, to))
          const startLine = doc.lineAt(safeFrom).number
          const endLine = doc.lineAt(safeTo).number
          for (let ln = startLine; ln <= endLine; ln++) {
            if (stampedLines.has(ln)) continue
            stampedLines.add(ln)
            decos.push(selectionLineDeco.range(doc.line(ln).from))
          }
          if (safeTo > safeFrom)
            decos.push(selectionMarkDeco.range(safeFrom, safeTo))
        }
        next = Decoration.set(decos, true)
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setErrors)) {
        const errors = e.value
        const doc = tr.state.doc
        const decos = []
        const messagedLines = new Set<number>()
        for (const err of errors) {
          const line = err.range.start.line
          // Guard non-integers too: a NaN line (e.g. an EOF-anchored error)
          // slips past a bare `< 1 || > lines` check and crashes `doc.line`.
          if (!Number.isInteger(line) || line < 1 || line > doc.lines) continue
          const lineObj = doc.line(line)
          decos.push(errorLineDeco.range(lineObj.from))
          // Wavy underline on the exact range, when it has width.
          const from = Math.max(0, Math.min(doc.length, err.range.start.offset))
          const to = Math.max(from, Math.min(doc.length, err.range.end.offset))
          if (to > from) decos.push(errorMarkDeco.range(from, to))
          // One inline message per line (join multiple errors on that line).
          if (!messagedLines.has(line)) {
            messagedLines.add(line)
            const message = errors
              .filter((x) => x.range.start.line === line)
              .map((x) => x.message)
              .join(' · ')
            decos.push(
              Decoration.widget({
                widget: new ErrorMessageWidget(message),
                side: 1,
              }).range(lineObj.to),
            )
          }
        }
        next = Decoration.set(decos, true)
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

const baseTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '12.5px',
      backgroundColor: '#18181b',
      color: '#d4d4d8',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: '22px',
      scrollbarColor: '#3f3f46 #18181b',
      scrollbarWidth: 'thin',
    },
    '.cm-scroller::-webkit-scrollbar': {
      width: '12px',
      height: '12px',
      backgroundColor: '#18181b',
    },
    '.cm-scroller::-webkit-scrollbar-track': {
      backgroundColor: '#18181b',
    },
    '.cm-scroller::-webkit-scrollbar-corner': {
      backgroundColor: '#18181b',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: '#3f3f46',
      borderRadius: '6px',
      border: '3px solid #18181b',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      backgroundColor: '#52525b',
    },
    '.cm-content': {
      caretColor: '#fafafa',
      padding: '8px 0',
    },
    '.cm-gutters': {
      backgroundColor: '#18181b',
      color: '#52525b',
      border: 'none',
      paddingRight: '6px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 14px 0 12px',
      minWidth: '32px',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(96, 165, 250, 0.10)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(96, 165, 250, 0.10)',
      color: 'oklch(0.7 0.14 250)',
    },
    '.cm-cursor': { borderLeftColor: '#fafafa' },
    '.cm-selectionBackground': {
      backgroundColor: 'rgba(96, 165, 250, 0.20) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(96, 165, 250, 0.25) !important',
    },
    '.cm-epure-sel-line': {
      backgroundColor: 'rgba(96, 165, 250, 0.14)',
      boxShadow: 'inset 2px 0 0 oklch(0.7 0.14 250)',
    },
    '.cm-epure-sel-mark': {
      backgroundColor: 'rgba(96, 165, 250, 0.22)',
      borderRadius: '2px',
    },
    '.cm-epure-error-line': {
      backgroundColor: 'rgba(255, 80, 80, 0.12)',
      boxShadow: 'inset 2px 0 0 #ff5d5d',
    },
    '.cm-epure-error-mark': {
      textDecoration: 'underline wavy #ff5d5d',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
    },
    '.cm-epure-error-msg': {
      marginLeft: '18px',
      color: '#ff8585',
      fontStyle: 'italic',
      fontSize: '11px',
      whiteSpace: 'pre-wrap',
      userSelect: 'none',
      pointerEvents: 'none',
    },

    // ── Search panel ────────────────────────────────────
    '.cm-panels': {
      backgroundColor: '#0f0f12',
      color: '#d4d4d8',
      border: 'none',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid #27272a',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid #27272a',
    },
    '.cm-panel.cm-search': {
      padding: '8px 10px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
      fontSize: '12px',
    },
    '.cm-panel.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      color: '#a1a1aa',
      fontSize: '11px',
      userSelect: 'none',
    },
    '.cm-panel.cm-search input[type=checkbox]': {
      accentColor: 'oklch(0.55 0.16 250)',
      margin: 0,
    },
    '.cm-panel.cm-search input[type=text], .cm-textfield': {
      backgroundColor: '#18181b',
      color: '#e4e4e7',
      border: '1px solid #27272a',
      borderRadius: '4px',
      padding: '4px 8px',
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: '12px',
      outline: 'none',
      minWidth: '180px',
    },
    '.cm-panel.cm-search input[type=text]:focus, .cm-textfield:focus': {
      borderColor: 'oklch(0.6 0.16 250)',
      boxShadow: '0 0 0 1px oklch(0.6 0.16 250 / 0.4)',
    },
    '.cm-panel.cm-search button, .cm-button': {
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      color: '#d4d4d8',
      border: '1px solid #27272a',
      borderRadius: '4px',
      padding: '4px 10px',
      fontSize: '11px',
      cursor: 'pointer',
      textTransform: 'none',
      fontFamily: 'inherit',
    },
    '.cm-panel.cm-search button:hover, .cm-button:hover': {
      backgroundColor: '#1f1f23',
      borderColor: '#3f3f46',
      color: '#fafafa',
    },
    '.cm-panel.cm-search button[name=close]': {
      position: 'absolute',
      top: '4px',
      right: '6px',
      padding: '2px 6px',
      border: 'none',
      fontSize: '14px',
      lineHeight: 1,
      color: '#71717a',
    },
    '.cm-panel.cm-search button[name=close]:hover': {
      color: '#e4e4e7',
      backgroundColor: 'transparent',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(250, 204, 21, 0.25)',
      outline: '1px solid rgba(250, 204, 21, 0.5)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(250, 204, 21, 0.5)',
      outline: '1px solid rgba(250, 204, 21, 0.9)',
    },
  },
  { dark: true },
)

export const CodeMirrorPane = forwardRef<CodeMirrorPaneHandle, CodeMirrorPaneProps>(
  function CodeMirrorPane({ value, onChange, errors, language }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)

    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useLayoutEffect(() => {
      if (!hostRef.current) return
      const startState = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          indentOnInput(),
          search({ top: true }),
          // Tab / Shift-Tab indent and dedent. CodeMirror leaves this out of the
          // default keymap (Tab is reserved for focus traversal), but an indented
          // block language like d2 wants it; listed last so it wins the binding.
          keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
          language ?? d2Support,
          baseTheme,
          selectionField,
          errorField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current(u.state.doc.toString())
            }
          }),
        ],
      })
      const view = new EditorView({ state: startState, parent: hostRef.current })
      viewRef.current = view
      return () => {
        view.destroy()
        viewRef.current = null
      }
      // We intentionally initialize once; downstream effects handle updates.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Sync external value -> editor without disrupting local typing.
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      const current = view.state.doc.toString()
      if (current === value) return
      view.dispatch({ changes: minimalDocChange(current, value) })
    }, [value])

    // Project parse errors into the editor (line highlight + underline + message).
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({ effects: setErrors.of(errors ?? []) })
    }, [errors])

    useImperativeHandle(ref, () => ({
      scrollToLine(line: number) {
        const view = viewRef.current
        if (!view) return
        const clamped = Math.max(1, Math.min(view.state.doc.lines, line))
        const pos = view.state.doc.line(clamped).from
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        })
        view.focus()
      },
      openSearch() {
        const view = viewRef.current
        if (!view) return
        view.focus()
        openSearchPanel(view)
      },
      highlightRanges(ranges) {
        const view = viewRef.current
        if (!view) return
        const docLen = view.state.doc.length
        const clamped = ranges
          .map((r) => ({
            from: Math.max(0, Math.min(docLen, r.from)),
            to: Math.max(0, Math.min(docLen, r.to)),
          }))
          .filter((r) => r.to >= r.from)
        const effects: StateEffect<unknown>[] = [
          setSelectionHighlights.of(clamped),
        ]
        if (clamped.length > 0) {
          effects.push(
            EditorView.scrollIntoView(clamped[0]!.from, { y: 'nearest' }),
          )
        }
        view.dispatch({ effects })
      },
    }))

    return <div ref={hostRef} className="cm-host" />
  },
)
