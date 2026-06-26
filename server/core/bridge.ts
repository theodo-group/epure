// Transport-agnostic bridge core: one instance per diagram. Watches the pair,
// emits per-kind change frames, and applies coherent inbound edits — with echo
// suppression so the server's own writes never bounce back as "disk changed".
//
// Both hosts (standalone server, Vite plugin) own a WebSocket and delegate all
// file logic here; this module knows nothing about sockets.

import { rename, writeFile } from 'node:fs/promises'

import { watch, type FSWatcher } from 'chokidar'

import { canonicalizeLayout } from '../../src/file/canonicalLayout'
import { validateLayoutJson } from '../../src/file/layoutSchema'

import { readFrame, verdictFor } from './frames'
import type { ResolvedPair } from './pair'
import {
  FILE_KINDS,
  type ApplyMsg,
  type FileChangedMsg,
  type FileFrame,
  type FileKind,
} from './protocol'

export interface BridgeCoreOptions {
  pair: ResolvedPair
  /** Called when a watched file changes on disk and the change is *not* an
   *  echo of our own write. */
  onFileChanged: (msg: FileChangedMsg) => void
}

/** Thrown by `applyInbound` when a kind fails validation; the host turns it
 *  into a `rejected` frame and keeps last-good bytes on disk. */
export class InvalidApplyError extends Error {
  constructor(
    readonly kind: FileKind,
    readonly detail: string | undefined,
  ) {
    super(`invalid ${kind}: ${detail ?? 'validation failed'}`)
    this.name = 'InvalidApplyError'
  }
}

export class BridgeCore {
  private readonly pair: ResolvedPair
  private readonly onFileChanged: BridgeCoreOptions['onFileChanged']
  private watcher: FSWatcher | null = null
  private readonly pathToKind = new Map<string, FileKind>()
  /** Content-key of the last bytes we wrote per kind; an incoming watch event
   *  with a matching key is our own write and is dropped. */
  private readonly lastWrittenKey: Partial<Record<FileKind, string>> = {}

  constructor(opts: BridgeCoreOptions) {
    this.pair = opts.pair
    this.onFileChanged = opts.onFileChanged
    for (const kind of FILE_KINDS) {
      this.pathToKind.set(this.pair.paths[kind], kind)
    }
  }

  get doc(): string {
    return this.pair.stem
  }

  /** Begin watching the pair. `awaitWriteFinish` coalesces editors' temp-write
   *  + rename sequences so we never read a half-written file. */
  async start(): Promise<void> {
    if (this.watcher) return
    this.watcher = watch([...this.pathToKind.keys()], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 20 },
    })
    const onEvent = (path: string) => {
      void this.handleDiskEvent(path)
    }
    this.watcher.on('add', onEvent)
    this.watcher.on('change', onEvent)
    this.watcher.on('unlink', (path) => {
      const kind = this.pathToKind.get(path)
      if (!kind) return
      delete this.lastWrittenKey[kind]
      this.onFileChanged({
        type: 'fileChanged',
        doc: this.doc,
        kind,
        content: null,
        valid: true,
      })
    })
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }

  /** Read every sidecar's current state for the first-load `hydrate` frame. */
  async hydrate(): Promise<FileFrame[]> {
    return Promise.all(
      FILE_KINDS.map((kind) => readFrame(kind, this.pair.paths[kind])),
    )
  }

  private async handleDiskEvent(path: string): Promise<void> {
    const kind = this.pathToKind.get(path)
    if (!kind) return
    const frame = await readFrame(kind, path)

    // Echo suppression: compare the *semantic* key, not raw bytes, so layout
    // formatting differences don't masquerade as a change.
    if (frame.valid && frame.content !== null) {
      const key = verdictFor(kind, frame.content).key
      if (key !== null && key === this.lastWrittenKey[kind]) return
    }

    this.onFileChanged({
      type: 'fileChanged',
      doc: this.doc,
      kind,
      content: frame.content,
      valid: frame.valid,
      ...(frame.error ? { error: frame.error } : {}),
    })
  }

  /**
   * Apply a coherent multi-file edit from the UI. Validates every kind first
   * (all-or-nothing: a single invalid kind rejects the whole envelope, leaving
   * disk untouched), canonicalizes layout, then writes temps and renames them
   * back-to-back to shrink the cross-file window. Returns the kinds written.
   */
  async applyInbound(files: ApplyMsg['files']): Promise<FileKind[]> {
    // 1. Validate + canonicalize everything before touching disk.
    const planned: { kind: FileKind; path: string; bytes: string }[] = []
    for (const file of files) {
      const bytes = this.finalBytes(file.kind, file.content)
      planned.push({ kind: file.kind, path: this.pair.paths[file.kind], bytes })
    }

    // 2. Record echo keys *before* writing so the watch events they trigger are
    //    already recognised as ours by the time they arrive.
    for (const p of planned) {
      const key = verdictFor(p.kind, p.bytes).key
      if (key !== null) this.lastWrittenKey[p.kind] = key
    }

    // 3. Coherent write: all temps first, then rename back-to-back. True
    //    cross-file atomicity is impossible, but every intermediate state is
    //    non-corrupting (Phase 0 tolerates a node present in d2 but missing in
    //    layout), so a torn write is at worst a transient auto-placed node.
    const temps = planned.map((p) => ({ ...p, tmp: `${p.path}.epure.tmp` }))
    await Promise.all(temps.map((p) => writeFile(p.tmp, p.bytes, 'utf8')))
    for (const p of temps) {
      await rename(p.tmp, p.path)
    }

    return planned.map((p) => p.kind)
  }

  /** Validate content for a kind and return the exact bytes to persist:
   *  canonical form for layout, the raw human source for d2. */
  private finalBytes(kind: FileKind, content: string): string {
    if (kind === 'layout') {
      const result = validateLayoutJson(content)
      if (!result.value) {
        throw new InvalidApplyError(kind, result.errors[0]?.message)
      }
      return canonicalizeLayout(result.value)
    }
    const v = verdictFor(kind, content)
    if (!v.valid) throw new InvalidApplyError(kind, v.error)
    return content
  }
}
