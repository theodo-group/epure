import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { validateLayoutJson } from '@/file/layoutSchema'
import type { ParseError } from '@/parser/ast'
import type { LayoutSidecar } from '@/layout/types'

export interface LayoutEditorBuffer {
  /** Controlled value for the layout JSON CodeMirror pane. */
  text: string
  /** Syntax/schema errors for the current text (empty when it's a valid layout). */
  errors: ParseError[]
  /** Handle a keystroke: update the buffer and push to the store when valid. */
  edit: (raw: string) => void
  /** Drop any in-progress (invalid) buffer so the next store-layout change
   *  re-baselines the editor. Call when a whole new document is loaded/opened,
   *  where discarding the current buffer is the intent. */
  reset: () => void
  /** Rewrite the buffer as the canonical layout text — the bytes the bridge
   *  writes to disk. The store already holds this layout (a valid buffer has
   *  been pushed to it), so only the text changes: no store write, no undo
   *  entry. Returns false, doing nothing, when the text is invalid or already
   *  canonical. */
  format: () => boolean
}

/**
 * Owns the layout JSON editor's text and reconciles it with `store.layout`.
 *
 * The buffer is a *second* representation of the layout: valid keystrokes are
 * pushed to the store immediately; invalid ones (bad JSON or a schema
 * violation) stay only in the buffer, because the store can't hold them.
 *
 * The subtle direction is store → buffer. When the layout changes from
 * ELSEWHERE — a canvas node drag, a remote/disk write, an undo — the editor
 * should follow so it shows the new positions. But it must NOT do that while the
 * buffer holds unsaved invalid edits, or a stray node drag silently throws away
 * whatever the user was typing. That used to happen because the resync compared
 * the buffer only against the *current* store and couldn't tell "stale because
 * the canvas moved" from "diverged because the user is mid-edit". A dirty latch
 * makes the distinction: it flips on only when the user types something the
 * store rejects, so store-driven changes never clobber in-progress work.
 */
export const useLayoutEditorBuffer = (
  layout: LayoutSidecar,
  setLayout: (layout: LayoutSidecar) => void,
): LayoutEditorBuffer => {
  // The store's layout shown as the canonical text the bridge writes to disk.
  const formatted = useMemo(() => canonicalizeLayout(layout), [layout])
  const [text, setText] = useState(formatted)
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  // True once the user types something that doesn't reach the store (invalid
  // JSON / schema). Cleared when they make it valid again (`edit`) or a new
  // document is loaded (`reset`). While set, store → buffer resyncs are skipped.
  const dirtyRef = useRef(false)

  // store layout → buffer, on every store-layout change. Skip when the buffer is
  // dirty (never destroy unsaved edits) and when it already represents the store
  // (so a valid local edit isn't reformatted out from under the caret).
  useEffect(() => {
    if (dirtyRef.current) return
    try {
      if (JSON.stringify(JSON.parse(textRef.current)) === JSON.stringify(layout)) {
        return
      }
    } catch {
      // Unparseable but not dirty (e.g. just after a reset) — re-baseline below.
    }
    setText(formatted)
  }, [formatted, layout])

  const errors = useMemo(() => validateLayoutJson(text).errors, [text])

  const edit = useCallback(
    (raw: string) => {
      // The pane re-emitting the text the buffer already holds is no edit.
      if (raw === textRef.current) return
      setText(raw)
      const result = validateLayoutJson(raw)
      dirtyRef.current = result.value === null
      if (result.value) setLayout(result.value)
    },
    [setLayout],
  )

  const reset = useCallback(() => {
    dirtyRef.current = false
  }, [])

  const format = useCallback((): boolean => {
    const current = textRef.current
    const { value } = validateLayoutJson(current)
    if (!value) return false
    const canonical = canonicalizeLayout(value)
    if (canonical === current) return false
    // Set the ref now, not after render: the pane echoes the new value back
    // through `edit`, which must see it as the text it already holds.
    textRef.current = canonical
    setText(canonical)
    return true
  }, [])

  return { text, errors, edit, reset, format }
}
