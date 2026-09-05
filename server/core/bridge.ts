// Transport-agnostic bridge core: one instance per diagram. Watches the pair,
// emits per-kind change frames, and applies coherent inbound edits — with echo
// suppression so the server's own writes never bounce back as "disk changed".
//
// Both hosts (standalone server, Vite plugin) own a WebSocket and delegate all
// file logic here; this module knows nothing about sockets.

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { watch, type FSWatcher } from 'chokidar'

import { canonicalizeLayout } from '../../src/file/canonicalLayout'
import { validateLayoutJson } from '../../src/file/layoutSchema'
import { setLibavoidWasmPath } from '../../src/layout/elk'
import { png as renderPng } from '../render'

import { readFrame, verdictFor } from './frames'
import type { ResolvedPair } from './pair'
import {
  FILE_KINDS,
  type ApplyMsg,
  type FileChangedMsg,
  type FileFrame,
  type FileKind,
} from './protocol'

/** Config for the rendered PNG that trails the text pair. When present, every
 *  editor apply re-renders `<stem>.png` next to the sidecars so the image stays
 *  in step with the reviewable `.epr.*` files. */
export interface PngSidecarOptions {
  /** Icons root so logos inline into the PNG (`<iconsDir>/aws/.../x.png`).
   *  Omitted → icon hrefs are left as-is and the rasterizer skips them. */
  iconsDir?: string
  /** Absolute path to `libavoid.wasm` so edge routing matches the editor.
   *  Omitted → routing falls back to stub routes (still a valid PNG). */
  wasmPath?: string
  /** Resolution multiplier; defaults to 2 (matches `epure export`). */
  scale?: number
}

export interface BridgeCoreOptions {
  pair: ResolvedPair
  /** Called when a watched file changes on disk and the change is *not* an
   *  echo of our own write. */
  onFileChanged: (msg: FileChangedMsg) => void
  /** When set, keep a rendered PNG sidecar in sync with the text pair on every
   *  apply. Omit to disable (e.g. in tests, or hosts that can't render). */
  png?: PngSidecarOptions
}

// How many recent self-write keys to remember per kind for echo suppression.
// The client writes on every keystroke, so a burst is many writes; this only has
// to outlast the watcher's coalescing + read latency, not a whole session.
const ECHO_HISTORY = 64

// Coalesce a keystroke burst (the client applies on every keystroke) into a
// single PNG render: long enough to outlast a typing burst, short enough that
// the image feels live once editing settles.
const PNG_DEBOUNCE_MS = 400

// Server-side rendering routes through libavoid's wasm. When the wasm can't
// load, emscripten `abort()`s with a *floating* rejection that escapes the
// render's try/catch and would crash the long-running host. Swallow ONLY
// wasm/libavoid rejections (real bugs still surface via the re-throw). Installed
// once per process, the first time a png-enabled core is created.
let wasmRejectionGuardInstalled = false
const installWasmRejectionGuard = (): void => {
  if (wasmRejectionGuardInstalled) return
  wasmRejectionGuardInstalled = true
  process.on('unhandledRejection', (err) => {
    const s = String(err)
    if (s.includes('wasm') || s.includes('libavoid')) return
    throw err
  })
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
  /** Content-keys we've written per kind, oldest→newest (capped at
   *  ECHO_HISTORY). An incoming watch event whose key matches ANY of these is
   *  our own write and is dropped. Remembering only the *latest* write is not
   *  enough: the client writes on every keystroke, chokidar coalesces those
   *  writes on its side, and an `awaitWriteFinish` event can surface an EARLIER
   *  write's content (read async, after `applyInbound` has already recorded a
   *  newer key). Matching just the newest key lets that stale self-write look
   *  like an external "disk changed" and clobber the editor mid-type. */
  private readonly writtenKeys = new Map<FileKind, string[]>()
  /** PNG-sidecar rendering state; all inert when `png` is undefined. */
  private readonly png?: PngSidecarOptions
  private pngTimer: ReturnType<typeof setTimeout> | null = null
  private pngRendering = false
  private pngDirty = false

  constructor(opts: BridgeCoreOptions) {
    this.pair = opts.pair
    this.onFileChanged = opts.onFileChanged
    this.png = opts.png
    if (opts.png) {
      if (opts.png.wasmPath) setLibavoidWasmPath(opts.png.wasmPath)
      installWasmRejectionGuard()
    }
    for (const kind of FILE_KINDS) {
      this.pathToKind.set(this.pair.paths[kind], kind)
    }
  }

  get doc(): string {
    return this.pair.stem
  }

  /** Remember a key we just wrote, capped to the most-recent ECHO_HISTORY. */
  private recordWrite(kind: FileKind, key: string): void {
    const keys = this.writtenKeys.get(kind) ?? []
    keys.push(key)
    if (keys.length > ECHO_HISTORY) keys.splice(0, keys.length - ECHO_HISTORY)
    this.writtenKeys.set(kind, keys)
  }

  /** True when a disk event's key matches one of our recent writes (an echo). */
  private isOwnEcho(kind: FileKind, key: string): boolean {
    return this.writtenKeys.get(kind)?.includes(key) ?? false
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
      // A delete is a genuine external event; forget our write history for this
      // kind so a later re-add of previously-written content isn't suppressed.
      this.writtenKeys.delete(kind)
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
    if (this.pngTimer) {
      clearTimeout(this.pngTimer)
      this.pngTimer = null
    }
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
      if (key !== null && this.isOwnEcho(kind, key)) return
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
      if (key !== null) this.recordWrite(p.kind, key)
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

    // 4. Keep the rendered PNG sidecar in step with the text pair.
    if (this.png) this.schedulePng()

    return planned.map((p) => p.kind)
  }

  /** Debounce a PNG re-render so a keystroke burst collapses into one render
   *  once editing settles. */
  private schedulePng(): void {
    if (this.pngTimer) clearTimeout(this.pngTimer)
    this.pngTimer = setTimeout(() => {
      this.pngTimer = null
      void this.renderPngSidecar()
    }, PNG_DEBOUNCE_MS)
  }

  /** Render the current on-disk pair to `<stem>.png`. Serialized: a render
   *  requested while one is running marks the result dirty and re-renders after,
   *  so the PNG never lags the latest edit. Failures are swallowed — the editor
   *  write already succeeded, and a stale/missing PNG must never break it. */
  private async renderPngSidecar(): Promise<void> {
    if (this.pngRendering) {
      this.pngDirty = true
      return
    }
    this.pngRendering = true
    this.pngDirty = false
    try {
      await this.writePng()
    } catch (err) {
      process.stderr.write(`epure: PNG sidecar render failed: ${String(err)}\n`)
    } finally {
      this.pngRendering = false
      if (this.pngDirty) this.schedulePng()
    }
  }

  private async writePng(): Promise<void> {
    const png = this.png
    if (!png) return
    // Read the freshly-written pair back so d2 + layout are mutually coherent
    // (applyInbound writes only the dirty kinds; the other is already on disk).
    const [d2, layoutText] = await Promise.all([
      readFile(this.pair.paths.d2, 'utf8').catch(() => null),
      readFile(this.pair.paths.layout, 'utf8').catch(() => null),
    ])
    if (d2 === null) return // no topology yet — nothing to draw
    const result = await renderPng(d2, layoutText, {
      scale: png.scale ?? 2,
      // Preserve the configured behavior: no iconsDir means no inlining (the
      // hrefs stay as-is), not the packaged default.
      icons: png.iconsDir ?? false,
    })
    if (!Buffer.isBuffer(result)) return // invalid d2 → leave the last good PNG
    const dest = join(this.pair.dir, `${this.pair.stem}.png`)
    const tmp = `${dest}.epure.tmp`
    await writeFile(tmp, result)
    await rename(tmp, dest)
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
