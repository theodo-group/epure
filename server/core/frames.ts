// Read a sidecar file into a wire `FileFrame`. Validation and the echo key come
// from `contentVerdict` (src/bridge/sync.ts), the one implementation the editor
// uses too, so the bridge never disagrees with the UI about whether a file is
// well-formed.

import { readFile } from 'node:fs/promises'

import { contentVerdict } from '../../src/bridge/sync'

import type { FileFrame, FileKind } from './protocol'

/**
 * Read a sidecar into a frame. A missing file is `{ content: null, valid: true }`
 * — absence is a legitimate state (e.g. no layout yet), not an error.
 */
export const readFrame = async (kind: FileKind, path: string): Promise<FileFrame> => {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind, content: null, valid: true }
    }
    throw e
  }
  const v = contentVerdict(kind, content)
  return v.valid ? { kind, content, valid: true } : { kind, content, valid: false, error: v.error }
}
