import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'

import { BridgeCore, ECHO_HISTORY, EchoHistory, InvalidApplyError } from './bridge'
import { contentVerdict } from '../../src/bridge/sync'
import { resolvePair } from './pair'
import { portForPath } from './port'
import type { FileChangedMsg } from './protocol'

// Test seams, both pass-through by default:
// - chokidar's `watch` records the watcher it hands the core, so a test can
//   await its `ready`; with `fake` set it hands back a bare emitter instead, so
//   a test drives the core's disk-event handler with exact, synthetic events.
// - `readFrame` records every disk read the core starts, so a test can wait
//   until the watcher has actually delivered (and the core handled) an event
//   instead of sleeping and hoping.
const seams = vi.hoisted(() => ({
  fake: false,
  watcher: null as import('node:events').EventEmitter | null,
  reads: [] as { path: string; done: Promise<unknown> }[],
}))

vi.mock('chokidar', async (importOriginal) => {
  const real = await importOriginal<typeof import('chokidar')>()
  const watch = (...args: Parameters<typeof real.watch>) => {
    const w = seams.fake
      ? Object.assign(new EventEmitter(), { close: async () => {} })
      : real.watch(...args)
    seams.watcher = w
    return w
  }
  return { ...real, watch }
})

vi.mock('./frames', async (importOriginal) => {
  const real = await importOriginal<typeof import('./frames')>()
  const readFrame: typeof real.readFrame = (kind, path) => {
    const done = real.readFrame(kind, path)
    seams.reads.push({ path, done })
    return done
  }
  return { ...real, readFrame }
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Poll until `check()` is truthy; throw if `timeout` ms pass first. */
const waitFor = async (check: () => Promise<boolean> | boolean, timeout = 3000) => {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time')
    await wait(5)
  }
}

/** Let every disk read the core has started finish, and its handler run on. */
const drainReads = async () => {
  await Promise.all(seams.reads.map((r) => r.done))
  await new Promise((r) => setImmediate(r))
}

const D2 = 'a\nb\na -> b\n'
const LAYOUT_MESSY =
  '{ "gridSize":40, "nodes": { "a": {"cy":2,"cx":1,"w":4,"h":2}, "b": {"cx":7,"cy":2,"w":4,"h":2} }, "edges":{} }'

describe('portForPath', () => {
  it('is deterministic and lands in the IANA ephemeral range', () => {
    const p = portForPath('/repo/docs/system.epr.d2')
    expect(p).toBe(portForPath('/repo/docs/system.epr.d2'))
    expect(p).toBeGreaterThanOrEqual(49152)
    expect(p).toBeLessThanOrEqual(65535)
  })

  it('separates different diagrams', () => {
    expect(portForPath('/a/x.epr.d2')).not.toBe(portForPath('/a/y.epr.d2'))
  })
})

describe('echo content keys', () => {
  it('treats reformatted layout as the same key but a real edit as different', () => {
    const a = contentVerdict('layout', LAYOUT_MESSY).key
    const reformatted = canonicalizeLayout({
      gridSize: 40,
      nodes: { a: { cx: 1, cy: 2, w: 4, h: 2 }, b: { cx: 7, cy: 2, w: 4, h: 2 } },
      edges: {},
    })
    expect(contentVerdict('layout', reformatted).key).toBe(a)
    const moved = LAYOUT_MESSY.replace('"cx":1', '"cx":3')
    expect(contentVerdict('layout', moved).key).not.toBe(a)
  })

  it('keys d2 by raw bytes', () => {
    expect(contentVerdict('d2', D2).key).toBe(D2)
    expect(contentVerdict('d2', `${D2}\n`).key).not.toBe(D2)
  })
})

describe('EchoHistory', () => {
  // A keystroke storm: typing "service" writes every prefix in turn.
  const storm = ['s', 'se', 'ser', 'serv', 'servi', 'servic', 'service'].map((w) => `${w}\n`)

  it('recognises every write of a keystroke storm, not just the latest', () => {
    // Regression: chokidar's awaitWriteFinish coalesces a burst of writes and
    // can surface an EARLIER write's content after newer keys were recorded.
    // Remembering only the last key let that stale self-write masquerade as
    // "disk changed" and clobber the editor mid-type.
    const h = new EchoHistory()
    for (const key of storm) h.record('d2', key)
    for (const key of storm) expect(h.has('d2', key)).toBe(true)
    expect(h.has('d2', 'servicex\n')).toBe(false)
  })

  it('keeps kinds apart', () => {
    const h = new EchoHistory()
    h.record('d2', 'x')
    expect(h.has('layout', 'x')).toBe(false)
  })

  it('caps the history at ECHO_HISTORY, evicting the oldest', () => {
    const h = new EchoHistory()
    for (let i = 0; i < ECHO_HISTORY; i++) h.record('d2', `k${i}`)
    for (let i = 0; i < ECHO_HISTORY; i++) expect(h.has('d2', `k${i}`)).toBe(true)
    h.record('d2', 'newest')
    expect(h.has('d2', 'k0')).toBe(false)
    expect(h.has('d2', 'k1')).toBe(true)
    expect(h.has('d2', 'newest')).toBe(true)
  })

  it('forgets a kind entirely', () => {
    const h = new EchoHistory()
    h.record('d2', 'x')
    h.record('layout', 'y')
    h.forget('d2')
    expect(h.has('d2', 'x')).toBe(false)
    expect(h.has('layout', 'y')).toBe(true)
  })
})

describe('BridgeCore', () => {
  let dir: string
  let core: BridgeCore
  const changes: FileChangedMsg[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'epure-bridge-'))
    changes.length = 0
    seams.fake = false
    seams.watcher = null
    seams.reads.length = 0
    const pair = resolvePair(join(dir, 'system.epr.d2'))
    core = new BridgeCore({ pair, onFileChanged: (m) => changes.push(m) })
  })

  afterEach(async () => {
    await core.stop()
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a coherent pair, canonicalizing layout', async () => {
    const written = await core.applyInbound([
      { kind: 'd2', content: D2 },
      { kind: 'layout', content: LAYOUT_MESSY },
    ])
    expect(written.sort()).toEqual(['d2', 'layout'])

    const onDiskD2 = await readFile(join(dir, 'system.epr.d2'), 'utf8')
    const onDiskLayout = await readFile(join(dir, 'system.epr.layout.json'), 'utf8')
    expect(onDiskD2).toBe(D2)
    // Layout landed in canonical form, not the messy input bytes.
    expect(onDiskLayout).not.toBe(LAYOUT_MESSY)
    expect(onDiskLayout.endsWith('}\n')).toBe(true)
    expect(contentVerdict('layout', onDiskLayout).valid).toBe(true)
  })

  it('rejects an invalid layout without touching disk', async () => {
    await expect(
      core.applyInbound([{ kind: 'layout', content: '{ not json' }]),
    ).rejects.toBeInstanceOf(InvalidApplyError)
    await expect(readFile(join(dir, 'system.epr.layout.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('hydrate reports absent files as null, present files validated', async () => {
    await writeFile(join(dir, 'system.epr.d2'), D2, 'utf8')
    const frames = await core.hydrate()
    const byKind = Object.fromEntries(frames.map((f) => [f.kind, f]))
    expect(byKind.d2).toMatchObject({ content: D2, valid: true })
    expect(byKind.layout).toMatchObject({ content: null, valid: true })
  })

  it('drops a stale echo of any write in a keystroke storm, reports a real edit', async () => {
    // The storm regression end to end through the core, with the watcher
    // events delivered by hand: after the whole burst is written, the watcher
    // surfaces each EARLIER write's content (what awaitWriteFinish can do).
    // Every one is ours and must be dropped; a genuinely new edit must not be.
    seams.fake = true
    await core.start()
    const d2Path = join(dir, 'system.epr.d2')
    const word = 'service'
    for (let i = 1; i <= word.length; i++) {
      await core.applyInbound([{ kind: 'd2', content: `${word.slice(0, i)}\n` }])
    }
    for (let i = 1; i <= word.length; i++) {
      await writeFile(d2Path, `${word.slice(0, i)}\n`, 'utf8')
      seams.watcher!.emit('change', d2Path)
      await drainReads()
    }
    expect(changes).toEqual([])

    await writeFile(d2Path, 'servicex\n', 'utf8')
    seams.watcher!.emit('change', d2Path)
    await drainReads()
    expect(changes).toEqual([
      { type: 'fileChanged', doc: 'system', kind: 'd2', content: 'servicex\n', valid: true },
    ])
  })

  it('reports a delete and forgets the history, so a re-add is reported', async () => {
    seams.fake = true
    await core.start()
    const d2Path = join(dir, 'system.epr.d2')
    await core.applyInbound([{ kind: 'd2', content: D2 }])

    await rm(d2Path)
    seams.watcher!.emit('unlink', d2Path)
    expect(changes).toEqual([
      { type: 'fileChanged', doc: 'system', kind: 'd2', content: null, valid: true },
    ])

    // Someone restores the very bytes we once wrote: no longer our echo.
    await writeFile(d2Path, D2, 'utf8')
    seams.watcher!.emit('add', d2Path)
    await drainReads()
    expect(changes.at(-1)).toEqual({
      type: 'fileChanged',
      doc: 'system',
      kind: 'd2',
      content: D2,
      valid: true,
    })
  })

  it('renders a PNG sidecar next to the pair after an apply (png enabled)', async () => {
    const pair = resolvePair(join(dir, 'system.epr.d2'))
    // scale:1 keeps the raster small; real wasm path so routing runs (not the
    // stub fallback); iconsDir omitted (plain a/b nodes need no icons); no
    // debounce, so the render starts at once.
    const wasmPath = join(process.cwd(), 'public', 'libavoid.wasm')
    const pngCore = new BridgeCore({
      pair,
      onFileChanged: () => {},
      png: { scale: 1, wasmPath, debounceMs: 0 },
    })
    try {
      await pngCore.applyInbound([
        { kind: 'd2', content: D2 },
        { kind: 'layout', content: LAYOUT_MESSY },
      ])
      const dest = join(dir, 'system.png')
      // Rasterized off the apply path — poll for the finished file.
      await waitFor(async () => {
        const buf = await readFile(dest).catch(() => null)
        return buf !== null && buf.length > 100
      })
      const buf = await readFile(dest)
      expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC)
      // No stray temp file left behind by the atomic write.
      await expect(readFile(`${dest}.epure.tmp`)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await pngCore.stop()
    }
  })

  it('leaves no PNG sidecar when png is not configured', async () => {
    // A render is only ever started from the debounce timer; on a fake clock,
    // "no timer was scheduled" is the proof — no need to sleep past it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pngCore = new BridgeCore({
      pair: resolvePair(join(dir, 'other.epr.d2')),
      onFileChanged: () => {},
      png: { scale: 1 },
    })
    try {
      // Control: a png-enabled core does schedule its render on that timer.
      await pngCore.applyInbound([{ kind: 'd2', content: D2 }])
      expect(vi.getTimerCount()).toBe(1)
      await pngCore.stop() // cancels it; this test never rasterizes

      await core.applyInbound([
        { kind: 'd2', content: D2 },
        { kind: 'layout', content: LAYOUT_MESSY },
      ])
      expect(vi.getTimerCount()).toBe(0)
      await vi.runAllTimersAsync()
      await expect(readFile(join(dir, 'system.png'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses the echo of its own write but reports a real disk edit (real watcher)', async () => {
    // Smoke test of the real chokidar path. Every wait is on an event: the
    // watcher being ready, the core having read our own writes back (and
    // dropped them), the external edit arriving.
    const d2Path = join(dir, 'system.epr.d2')
    const layoutPath = join(dir, 'system.epr.layout.json')
    // The pair exists before the watch starts, as it does when a host opens it.
    await writeFile(d2Path, 'x\n', 'utf8')
    await writeFile(layoutPath, canonicalizeLayout({ gridSize: 40, nodes: {}, edges: {} }), 'utf8')
    await core.start()
    await new Promise((r) => seams.watcher!.once('ready', r))
    await core.applyInbound([
      { kind: 'd2', content: D2 },
      { kind: 'layout', content: LAYOUT_MESSY },
    ])
    // The watcher delivered both writes and the core handled them: our own
    // echoes, so nothing was reported.
    await waitFor(() => [d2Path, layoutPath].every((p) => seams.reads.some((r) => r.path === p)))
    await drainReads()
    expect(changes).toEqual([])

    // Now a genuine external edit (as if CC wrote it).
    const edited = 'a\nb\nc\na -> b\n'
    await writeFile(d2Path, edited, 'utf8')
    await waitFor(() => changes.length > 0)
    expect(changes).toEqual([
      { type: 'fileChanged', doc: 'system', kind: 'd2', content: edited, valid: true },
    ])
  })
})
