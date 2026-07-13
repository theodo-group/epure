import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canonicalizeLayout } from '@/file/canonicalLayout'

import { BridgeCore, InvalidApplyError } from './bridge'
import { verdictFor } from './frames'
import { resolvePair } from './pair'
import { portForPath } from './port'
import type { FileChangedMsg } from './protocol'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Poll until `check()` is truthy or the deadline passes. */
const waitFor = async (check: () => Promise<boolean>, timeout: number) => {
  const step = 100
  for (let waited = 0; waited < timeout; waited += step) {
    if (await check()) return
    await wait(step)
  }
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
    const a = verdictFor('layout', LAYOUT_MESSY).key
    const reformatted = canonicalizeLayout({
      gridSize: 40,
      nodes: { a: { cx: 1, cy: 2, w: 4, h: 2 }, b: { cx: 7, cy: 2, w: 4, h: 2 } },
      edges: {},
    })
    expect(verdictFor('layout', reformatted).key).toBe(a)
    const moved = LAYOUT_MESSY.replace('"cx":1', '"cx":3')
    expect(verdictFor('layout', moved).key).not.toBe(a)
  })

  it('keys d2 by raw bytes', () => {
    expect(verdictFor('d2', D2).key).toBe(D2)
    expect(verdictFor('d2', D2 + '\n').key).not.toBe(D2)
  })
})

describe('BridgeCore', () => {
  let dir: string
  let core: BridgeCore
  const changes: FileChangedMsg[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'epure-bridge-'))
    changes.length = 0
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
    expect(verdictFor('layout', onDiskLayout).valid).toBe(true)
  })

  it('rejects an invalid layout without touching disk', async () => {
    await expect(
      core.applyInbound([{ kind: 'layout', content: '{ not json' }]),
    ).rejects.toBeInstanceOf(InvalidApplyError)
    await expect(
      readFile(join(dir, 'system.epr.layout.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('hydrate reports absent files as null, present files validated', async () => {
    await writeFile(join(dir, 'system.epr.d2'), D2, 'utf8')
    const frames = await core.hydrate()
    const byKind = Object.fromEntries(frames.map((f) => [f.kind, f]))
    expect(byKind.d2).toMatchObject({ content: D2, valid: true })
    expect(byKind.layout).toMatchObject({ content: null, valid: true })
  })

  it('suppresses echoes of a keystroke storm, not just the latest write', async () => {
    // Regression: the client writes on every keystroke, so typing a label is a
    // burst of applyInbound calls. chokidar's awaitWriteFinish coalesces those
    // writes on its side and can surface an EARLIER write's content as an event
    // after our recorded key has moved on. Remembering only the last key let
    // that stale self-write masquerade as "disk changed" and clobber the editor
    // mid-type (cursor jumped to top, input lost). ~140ms gaps — human speed,
    // just above the 120ms stability threshold — is where it bit.
    await core.start()
    const word = 'service'
    for (let i = 1; i <= word.length; i++) {
      await core.applyInbound([{ kind: 'd2', content: `${word.slice(0, i)}\n` }])
      await wait(140)
    }
    await wait(450) // let any deferred watcher events fire
    // Every emitted change would be one of our own writes → all must be dropped.
    expect(changes).toHaveLength(0)
  }, 6000)

  it('renders a PNG sidecar next to the pair after an apply (png enabled)', async () => {
    const pair = resolvePair(join(dir, 'system.epr.d2'))
    // scale:1 keeps the raster small; real wasm path so routing runs (not the
    // stub fallback); iconsDir omitted (plain a/b nodes need no icons).
    const wasmPath = join(process.cwd(), 'public', 'libavoid.wasm')
    const pngCore = new BridgeCore({ pair, onFileChanged: () => {}, png: { scale: 1, wasmPath } })
    try {
      await pngCore.applyInbound([
        { kind: 'd2', content: D2 },
        { kind: 'layout', content: LAYOUT_MESSY },
      ])
      const dest = join(dir, 'system.png')
      // Debounced (400ms) then rasterized — poll for the finished file.
      await waitFor(async () => {
        const buf = await readFile(dest).catch(() => null)
        return buf !== null && buf.length > 100
      }, 6000)
      const buf = await readFile(dest)
      expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC)
      // No stray temp file left behind by the atomic write.
      await expect(readFile(`${dest}.epure.tmp`)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await pngCore.stop()
    }
  }, 10000)

  it('leaves no PNG sidecar when png is not configured', async () => {
    await core.applyInbound([
      { kind: 'd2', content: D2 },
      { kind: 'layout', content: LAYOUT_MESSY },
    ])
    await wait(600)
    await expect(readFile(join(dir, 'system.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('suppresses the echo of its own write but reports a real disk edit', async () => {
    await core.start()
    await core.applyInbound([
      { kind: 'd2', content: D2 },
      { kind: 'layout', content: LAYOUT_MESSY },
    ])
    // Give chokidar (awaitWriteFinish) time to fire — these are our own writes.
    await wait(450)
    expect(changes).toHaveLength(0)

    // Now a genuine external edit (as if CC wrote it).
    await writeFile(join(dir, 'system.epr.d2'), 'a\nb\nc\na -> b\n', 'utf8')
    await wait(450)
    const d2Changes = changes.filter((c) => c.kind === 'd2')
    expect(d2Changes.length).toBeGreaterThanOrEqual(1)
    expect(d2Changes.at(-1)!.content).toContain('c')
  }, 4000)
})
