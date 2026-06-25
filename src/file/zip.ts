import { strFromU8, unzipSync } from 'fflate'
import type { LayoutSidecar } from '@/layout/types'

const D2_NAME = 'diagram.d2'
const LAYOUT_NAME = 'layout.json'

export interface LoadedDocument {
  source: string
  layout: LayoutSidecar
  filename: string
  handle?: FileSystemFileHandle
}

const emptyLayout = (gridSize = 40): LayoutSidecar => ({
  gridSize,
  nodes: {},
  edges: {},
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
    typeof v.edges === 'object'
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

interface OpenFilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
    multiple?: boolean
  }) => Promise<FileSystemFileHandle[]>
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

