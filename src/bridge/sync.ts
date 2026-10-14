// Content identity + validity for both ends of the bridge: the editor (this is
// DOM-safe, no node imports) and the server (server/core imports it). One
// implementation means a layout's echo key is identical on both ends — the
// formatting oscillation can't reappear from either side.

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { validateLayoutJson } from '@/file/layoutSchema'
import { parse } from '@/parser'
import type { LayoutSidecar } from '@/layout/types'

import type { FileKind } from './protocol'

export interface ContentVerdict {
  valid: boolean
  /** `line:column message` of the first problem, when invalid. */
  error?: string
  /**
   * Normalized identity used to detect echoes. Two contents with the same key
   * are semantically identical:
   *   - `layout` is canonicalized, so the UI's `JSON.stringify` and CC's
   *     hand-formatting collapse to one key (kills the formatting oscillation),
   *   - `d2` is the human source itself, so the key is the raw bytes.
   * `null` when the content is invalid (an invalid file is never "written by
   * us" and never suppresses a future valid write).
   */
  key: string | null
}

/** Validate content for a kind, with the same parser and schema the editor
 *  uses, so the bridge never disagrees with the UI. Pure — no I/O. */
export const contentVerdict = (kind: FileKind, content: string): ContentVerdict => {
  switch (kind) {
    case 'd2': {
      const result = parse(content)
      if (result.ok) return { valid: true, key: content }
      const first = result.errors[0]
      return {
        valid: false,
        error: first ? formatError(first.message, first.range.start) : 'parse error',
        key: null,
      }
    }
    case 'layout': {
      const result = validateLayoutJson(content)
      if (result.value) return { valid: true, key: canonicalizeLayout(result.value) }
      const first = result.errors[0]
      return {
        valid: false,
        error: first ? formatError(first.message, first.range.start) : 'invalid layout',
        key: null,
      }
    }
  }
}

const formatError = (message: string, pos: { line: number; column: number }): string =>
  `${pos.line}:${pos.column} ${message}`

/** The content's identity (see `ContentVerdict.key`); null when invalid. */
export const contentKey = (kind: FileKind, content: string): string | null =>
  contentVerdict(kind, content).key

/** Canonical on-disk text for the store's layout object (the outbound form). */
export const layoutToText = (layout: LayoutSidecar): string => canonicalizeLayout(layout)

/** Validity gate: may this content be written to disk for this kind? */
export const isValid = (kind: FileKind, content: string): boolean =>
  contentKey(kind, content) !== null
