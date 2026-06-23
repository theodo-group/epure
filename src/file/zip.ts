import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { LayoutSidecar } from '@/layout/types'

const D2_NAME = 'diagram.d2'
const LAYOUT_NAME = 'layout.json'

export interface LoadedDocument {
  source: string
  layout: LayoutSidecar
  filename: string
  handle?: FileSystemFileHandle
}

const emptyLayout = (gridSize = 16): LayoutSidecar => ({
  gridSize,
  nodes: {},
  edges: {},
  areas: [],
})

const stripArchExt = (name: string): string =>
  name
    .replace(/\.arch\.zip$/i, '')
    .replace(/\.zip$/i, '')
    .replace(/\.arch$/i, '')

const isLayoutSidecar = (value: unknown): value is LayoutSidecar => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.gridSize === 'number' &&
    typeof v.nodes === 'object' &&
    typeof v.edges === 'object' &&
    Array.isArray(v.areas)
  )
}

const parseLayout = (raw: string): LayoutSidecar => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isLayoutSidecar(parsed)) return parsed
  } catch {
    /* fall through */
  }
  return emptyLayout()
}

export const readArchZip = async (
  blob: Blob,
  filename = 'system.arch',
): Promise<LoadedDocument> => {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const entries = unzipSync(buf)
  const d2 = entries[D2_NAME]
  const layoutRaw = entries[LAYOUT_NAME]
  if (!d2 || !layoutRaw) {
    throw new Error(`Invalid .arch.zip: expected ${D2_NAME} and ${LAYOUT_NAME}`)
  }
  return {
    source: strFromU8(d2),
    layout: parseLayout(strFromU8(layoutRaw)),
    filename: stripArchExt(filename),
  }
}

export const writeArchZip = async (
  source: string,
  layout: LayoutSidecar,
): Promise<Blob> => {
  const zipped = zipSync({
    [D2_NAME]: strToU8(source),
    [LAYOUT_NAME]: strToU8(JSON.stringify(layout, null, 2)),
  })
  // Copy into a fresh ArrayBuffer so the Blob constructor doesn't get a
  // SharedArrayBuffer-typed view.
  const out = new Uint8Array(zipped.length)
  out.set(zipped)
  return new Blob([out], { type: 'application/zip' })
}

interface OpenFilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
    multiple?: boolean
  }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }) => Promise<FileSystemFileHandle>
}

const supportsFileSystemAccess = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as OpenFilePickerWindow).showOpenFilePicker === 'function'

export const openWithFileSystemAccess = async (): Promise<LoadedDocument | null> => {
  if (supportsFileSystemAccess()) {
    const w = window as OpenFilePickerWindow
    try {
      const [handle] = await w.showOpenFilePicker!({
        types: [
          {
            description: 'archgrid diagram',
            accept: { 'application/zip': ['.zip', '.arch.zip'] },
          },
        ],
        multiple: false,
      })
      if (!handle) return null
      const file = await handle.getFile()
      const doc = await readArchZip(file, file.name)
      return { ...doc, handle }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    }
  }

  return new Promise<LoadedDocument | null>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,.arch.zip,application/zip'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      try {
        const doc = await readArchZip(file, file.name)
        resolve(doc)
      } catch (err) {
        reject(err)
      }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const saveWithFileSystemAccess = async (
  handle: FileSystemFileHandle | undefined,
  source: string,
  layout: LayoutSidecar,
  filename = 'system.arch',
): Promise<FileSystemFileHandle | undefined> => {
  const blob = await writeArchZip(source, layout)
  const suggested = `${stripArchExt(filename)}.arch.zip`

  if (handle && typeof handle.createWritable === 'function') {
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return handle
  }

  if (supportsFileSystemAccess()) {
    const w = window as OpenFilePickerWindow
    try {
      const fresh = await w.showSaveFilePicker!({
        suggestedName: suggested,
        types: [
          {
            description: 'archgrid diagram',
            accept: { 'application/zip': ['.zip', '.arch.zip'] },
          },
        ],
      })
      const writable = await fresh.createWritable()
      await writable.write(blob)
      await writable.close()
      return fresh
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return undefined
      throw err
    }
  }

  triggerDownload(blob, suggested)
  return undefined
}
