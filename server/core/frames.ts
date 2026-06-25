// Read + validate a sidecar file into a wire `FileFrame`, and compute the
// "content key" used for echo suppression.
//
// Validation reuses the *exact* same code the editor and CLI use — the
// Chevrotain `parse()` for `.d2` and `validateLayoutJson` for layout — so the
// bridge never disagrees with the UI about whether a file is well-formed.

import { readFile } from 'node:fs/promises'

import { parse } from '../../src/parser'
import { validateLayoutJson } from '../../src/file/layoutSchema'
import { canonicalizeLayout } from '../../src/file/canonicalLayout'

import type { FileFrame, FileKind } from './protocol'

export interface ContentVerdict {
  valid: boolean
  error?: string
  /**
   * Normalized identity used to detect echoes. Two contents with the same key
   * are semantically identical:
   *   - `layout` is canonicalized, so the UI's `JSON.stringify` and CC's
   *     hand-formatting collapse to one key (kills the formatting oscillation),
   *   - `d2` is the human source itself, so the key is the raw bytes,
   *   - `comments` is raw JSON text (reserved; not yet shipped).
   * `null` when the content is invalid (an invalid file is never "written by
   * us" and never suppresses a future valid write).
   */
  key: string | null
}

/** Validate file content for a kind. Pure — no I/O. */
export const verdictFor = (kind: FileKind, content: string): ContentVerdict => {
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
    case 'comments': {
      // Reserved sidecar: only a well-formedness check until the feature ships.
      try {
        JSON.parse(content)
        return { valid: true, key: content }
      } catch (e) {
        return { valid: false, error: (e as Error).message, key: null }
      }
    }
  }
}

const formatError = (
  message: string,
  pos: { line: number; column: number },
): string => `${pos.line}:${pos.column} ${message}`

/**
 * Read a sidecar into a frame. A missing file is `{ content: null, valid: true }`
 * — absence is a legitimate state (e.g. no layout yet), not an error.
 */
export const readFrame = async (
  kind: FileKind,
  path: string,
): Promise<FileFrame> => {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind, content: null, valid: true }
    }
    throw e
  }
  const v = verdictFor(kind, content)
  return v.valid
    ? { kind, content, valid: true }
    : { kind, content, valid: false, error: v.error }
}
