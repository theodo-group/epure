// Resolve the file pair from any reasonable user input: the `.epr.d2`, the
// `.epr.layout.json`, or the bare stem.

import { basename, dirname, isAbsolute, resolve } from 'node:path'

import type { FileKind } from './protocol'

export const EXT = {
  d2: '.epr.d2',
  layout: '.epr.layout.json',
} as const satisfies Record<FileKind, string>

export interface ResolvedPair {
  /** Directory containing the pair (absolute). Writes are confined here. */
  dir: string
  /** Bare diagram name, e.g. `system` for `system.epr.d2`. */
  stem: string
  /** Absolute path for each sidecar kind. */
  paths: Record<FileKind, string>
}

const stripKnownExt = (name: string): string | null => {
  for (const ext of Object.values(EXT)) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  return null
}

/**
 * Turn a CLI/host argument into a fully-resolved pair. Accepts the `.epr.d2`,
 * the `.epr.layout.json`, or a bare stem (`docs/x` → `docs/x.epr.*`). Throws on
 * an obviously wrong extension so a typo never silently resolves to the wrong
 * files.
 */
export const resolvePair = (input: string): ResolvedPair => {
  const abs = isAbsolute(input) ? input : resolve(process.cwd(), input)
  const dir = dirname(abs)
  const name = basename(abs)

  let stem = stripKnownExt(name)
  if (stem === null) {
    // Bare stem only if it carries no diagram-ish extension we don't recognise.
    if (name.includes('.epr.')) {
      throw new Error(
        `Unrecognised diagram file "${name}". Expected one of: ` +
          Object.values(EXT).join(', '),
      )
    }
    stem = name
  }

  const paths = {
    d2: resolve(dir, stem + EXT.d2),
    layout: resolve(dir, stem + EXT.layout),
  } satisfies Record<FileKind, string>

  return { dir, stem, paths }
}
