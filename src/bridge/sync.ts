// Client-side content identity + validity, mirroring the server's `verdictFor`
// but DOM-safe (no node imports). Crucially it reuses the SAME canonical layout
// serializer the server uses, so a layout's echo key is identical on both ends
// — the formatting oscillation can't reappear from the client side either.

import { canonicalizeLayout } from '@/file/canonicalLayout'
import { validateLayoutJson } from '@/file/layoutSchema'
import { parse } from '@/parser'
import type { LayoutSidecar } from '@/layout/types'

import type { FileKind } from './protocol'

/**
 * Normalized identity of a kind's content. Two contents with the same key are
 * semantically identical: layout is canonicalized; d2/comments are raw.
 * Returns null when the content is invalid (an invalid buffer has no identity
 * and is never written to disk).
 */
export const contentKey = (kind: FileKind, content: string): string | null => {
  switch (kind) {
    case 'd2':
      return parse(content).ok ? content : null
    case 'layout': {
      const result = validateLayoutJson(content)
      return result.value ? canonicalizeLayout(result.value) : null
    }
    case 'comments':
      try {
        JSON.parse(content)
        return content
      } catch {
        return null
      }
  }
}

/** Canonical on-disk text for the store's layout object (the outbound form). */
export const layoutToText = (layout: LayoutSidecar): string => canonicalizeLayout(layout)

/** Validity gate: may this content be written to disk for this kind? */
export const isValid = (kind: FileKind, content: string): boolean =>
  contentKey(kind, content) !== null
