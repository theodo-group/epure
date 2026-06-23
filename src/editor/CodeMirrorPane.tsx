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
  type DecorationSet,
} from '@codemirror/view'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { d2Support } from './d2-language'
import type { ParseError } from '@/parser/ast'

export interface CodeMirrorPaneHandle {
  scrollToLine: (line: number) => void
}

export interface CodeMirrorPaneProps {
  value: string
  onChange: (value: string) => void
  errors?: ParseError[]
}

// Light-weight "this line has a parse error" decoration; we don't pull the
// full lint package because the parser already gives us authoritative errors.
const setErrorLines = StateEffect.define<number[]>()

const errorLineDeco = Decoration.line({
  attributes: { class: 'cm-archgrid-error-line' },
})

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setErrorLines)) {
        const lines = e.value
        const decos = lines
          .filter((line) => line >= 1 && line <= tr.state.doc.lines)
          .map((line) => errorLineDeco.range(tr.state.doc.line(line).from))
        next = Decoration.set(decos, true)
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

const baseTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: '#1e1e1e' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    '.cm-content': { caretColor: '#fff' },
    '.cm-gutters': {
      backgroundColor: '#1e1e1e',
      color: '#6a6a6a',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-archgrid-error-line': {
      backgroundColor: 'rgba(255, 80, 80, 0.12)',
      boxShadow: 'inset 2px 0 0 #ff5d5d',
    },
  },
  { dark: true },
)

export const CodeMirrorPane = forwardRef<CodeMirrorPaneHandle, CodeMirrorPaneProps>(
  function CodeMirrorPane({ value, onChange, errors }, ref) {
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
          history(),
          bracketMatching(),
          indentOnInput(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          d2Support,
          baseTheme,
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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }, [value])

    // Project parse errors onto error lines.
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      const lines = (errors ?? []).map((e) => e.range.start.line)
      view.dispatch({ effects: setErrorLines.of(lines) })
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
    }))

    return <div ref={hostRef} className="cm-host" />
  },
)
