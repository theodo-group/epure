// Open: turn the files a user picks (or drops on the canvas) into a document.
// Accepts what Épure itself produces: the `.epr.d2` source, optionally with its
// `.epr.layout.json` sidecar, or a PNG exported by Épure — which carries both
// as text chunks (see `src/export/pngText.ts`). A `.d2` without a layout opens
// with auto-placed nodes, like a fresh pair in the CLI.

import { PNG_SOURCE_KEYS, readPngText } from '@/export/pngText'
import { validateLayoutJson } from '@/file/layoutSchema'
import type { LayoutSidecar } from '@/layout/types'

export interface LoadedDocument {
  source: string
  layout: LayoutSidecar
  /** Filename stem (e.g. `system`), for the UI + export name. */
  filename: string
}

/** A user-facing reason the picked files can't be opened. */
export class OpenError extends Error {}

const emptyLayout = (): LayoutSidecar => ({ gridSize: 40, nodes: {}, edges: {} })

const isPngFile = (f: File): boolean => /\.png$/i.test(f.name) || f.type === 'image/png'
const isD2File = (f: File): boolean => /\.d2$/i.test(f.name)
const isLayoutFile = (f: File): boolean => /\.json$/i.test(f.name)

const stemOf = (name: string): string =>
  name
    .replace(/\.png$/i, '')
    .replace(/\.layout\.json$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.d2$/i, '')
    .replace(/\.epr$/i, '')

const parseLayout = (text: string, from: string): LayoutSidecar => {
  const { value, errors } = validateLayoutJson(text)
  if (value) return value
  const first = errors[0]
  const where = first ? ` (line ${first.range.start.line})` : ''
  throw new OpenError(`${from} isn't a valid Épure layout${where}: ${first?.message ?? 'invalid'}`)
}

const openPng = async (file: File): Promise<LoadedDocument> => {
  const chunks = readPngText(new Uint8Array(await file.arrayBuffer()))
  const source = chunks[PNG_SOURCE_KEYS.d2]
  if (source === undefined) {
    throw new OpenError(
      `${file.name} has no Épure source inside. It may have been re-compressed (pasted, ` +
        'screenshotted or re-uploaded) — open the original exported file instead.',
    )
  }
  const layoutText = chunks[PNG_SOURCE_KEYS.layout]
  return {
    source,
    layout: layoutText === undefined ? emptyLayout() : parseLayout(layoutText, file.name),
    filename: stemOf(file.name),
  }
}

/** Load a document from picked or dropped files. Throws `OpenError` with a
 *  message fit for the user when the selection isn't something Épure opens. */
export const openFiles = async (files: readonly File[]): Promise<LoadedDocument> => {
  const png = files.find(isPngFile)
  if (png) return openPng(png)

  const d2 = files.find(isD2File)
  const layoutFile = files.find(isLayoutFile)
  if (!d2) {
    throw new OpenError(
      layoutFile
        ? 'Pick the .epr.d2 file too — a layout alone has no diagram.'
        : 'Épure opens .epr.d2 files (with their .epr.layout.json) and PNGs exported by Épure.',
    )
  }
  return {
    source: await d2.text(),
    layout: layoutFile ? parseLayout(await layoutFile.text(), layoutFile.name) : emptyLayout(),
    filename: stemOf(d2.name),
  }
}

/** Show the browser's file picker; resolves to the chosen files, or null when
 *  the user cancels. Multiple selection lets the user pick a `.d2` together with
 *  its layout. */
export const pickFiles = (): Promise<File[] | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.d2,.json,.png,image/png'
    input.onchange = () => resolve(input.files?.length ? [...input.files] : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
