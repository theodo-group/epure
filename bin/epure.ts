// `epure` CLI — the single entry users (and Claude Code) invoke.
//
//   epure <file>              start the live bridge server (default)
//   epure new <file>          scaffold a new pair from a seed (won't clobber)
//   epure export <file>       render a fit-to-content PNG (so Claude Code can see it)
//   epure poll <file>         long-poll the live toolbar for the next feedback event
//   epure validate <path...>  validate pair(s); non-zero exit on problems
//   epure fmt <file...>       rewrite layout(s) in canonical form
//   epure icons [query]       list available icons (providers, or search)
//   epure skill install       copy the epure-diagram skill to ~/.claude/skills
//                             (--local installs into ./.claude/skills instead)
//
// Deliberately no daemon / discovery file / lockfile / multiplex. One server
// per diagram on a deterministic port; the OS port-bind is the only lock.

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { get, request } from 'node:http'
import { mkdir, copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { canonicalizeLayout } from '../src/file/canonicalLayout'
import { validateLayoutJson } from '../src/file/layoutSchema'
import { setLibavoidWasmPath } from '../src/layout/elk'
import type { LayoutSidecar } from '../src/layout/types'

import { ICON_CATALOG, searchIcons, PROVIDERS } from '../src/icons'
import { resolvePair, type ResolvedPair, EXT } from '../server/core/pair'
import { portForPath } from '../server/core/port'
import { validatePair, type ValidationIssue } from '../server/core/validate'
import { renderDiagramPng } from '../server/render'
import { startStandalone } from '../server/standalone'

// Injected at build time via esbuild --define; falls back for ts-direct runs.
declare const __EPURE_VERSION__: string
const VERSION =
  typeof __EPURE_VERSION__ === 'string' ? __EPURE_VERSION__ : '0.0.0-dev'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = process.env.EPURE_DIST ?? resolve(HERE, '../dist')

// Logs go to stderr so stdout carries exactly one machine-readable line.
const log = (msg: string): void => {
  process.stderr.write(`epure: ${msg}\n`)
}

const SEED_LAYOUT: LayoutSidecar = {
  gridSize: 40,
  nodes: {
    user: { cx: 3, cy: 5, w: 2, h: 2, shape: 'person' },
    api: { cx: 10, cy: 5, w: 4, h: 2 },
  },
  edges: {},
}
const SEED_D2 = `user: User { shape: person }\napi: API { shape: rectangle }\n\nuser -> api\n`

// ── seed / resolve ──────────────────────────────────────────────────────────

const pairExists = (pair: ResolvedPair): boolean =>
  existsSync(pair.paths.d2) || existsSync(pair.paths.layout)

const seedPair = async (pair: ResolvedPair): Promise<void> => {
  await mkdir(pair.dir, { recursive: true })
  await writeFile(pair.paths.d2, SEED_D2, 'utf8')
  await writeFile(pair.paths.layout, canonicalizeLayout(SEED_LAYOUT), 'utf8')
}

// ── health probe (idempotency) ──────────────────────────────────────────────

const probeHealth = (port: number): Promise<string | null> =>
  new Promise((resolvePromise) => {
    const req = get(
      { host: '127.0.0.1', port, path: '/__epure/health', timeout: 800 },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolvePromise((JSON.parse(body) as { realPath?: string }).realPath ?? null)
          } catch {
            resolvePromise(null)
          }
        })
      },
    )
    req.on('error', () => resolvePromise(null))
    req.on('timeout', () => {
      req.destroy()
      resolvePromise(null)
    })
  })

// ── browser open (best-effort, non-fatal) ───────────────────────────────────

const openBrowser = (url: string): void => {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* non-fatal — the URL is printed regardless */
  }
}

// ── commands ────────────────────────────────────────────────────────────────

const printReady = (
  out: { url: string; port: number; reused: boolean; doc: string; file: string },
  json: boolean,
): void => {
  process.stdout.write(
    json
      ? JSON.stringify(out) + '\n'
      : `epure: ready url=${out.url} reused=${out.reused}\n`,
  )
}

const serve = async (file: string, json: boolean): Promise<void> => {
  const pair = resolvePair(file)
  if (!pairExists(pair)) {
    log(`no pair found — seeding ${pair.stem}.epr.*`)
    await seedPair(pair)
  }
  const realPath = realpathSync(pair.paths.d2)
  const token = randomUUID()
  const desiredPort = portForPath(realPath)

  let handle
  try {
    handle = await startStandalone({
      pairInput: file,
      port: desiredPort,
      token,
      distDir: DIST_DIR,
      version: VERSION,
    })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
    // Something already holds our port. If it's *this* diagram, reuse it.
    const occupantRealPath = await probeHealth(desiredPort)
    if (occupantRealPath === realPath) {
      printReady(
        { url: `http://127.0.0.1:${desiredPort}/`, port: desiredPort, reused: true, doc: pair.stem, file: realPath },
        json,
      )
      log('reusing the server already serving this diagram')
      return
    }
    // Hash collision with a different diagram → OS-assigned port (URL not stable).
    log(`port ${desiredPort} is taken by another diagram — using an ephemeral port (URL not stable across sessions)`)
    handle = await startStandalone({
      pairInput: file,
      port: 0,
      token,
      distDir: DIST_DIR,
      version: VERSION,
    })
  }

  openBrowser(handle.url)
  printReady(
    { url: handle.url, port: handle.port, reused: false, doc: pair.stem, file: handle.realPath },
    json,
  )
  log(`serving ${pair.stem} — edit ${pair.stem}${EXT.d2} / ${pair.stem}${EXT.layout}`)

  const shutdown = () => {
    void handle.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const cmdNew = async (file: string): Promise<number> => {
  const pair = resolvePair(file)
  if (pairExists(pair)) {
    log(`refusing to overwrite existing ${pair.stem}.epr.* — pick another name`)
    return 1
  }
  await seedPair(pair)
  log(`created ${pair.paths.d2} and ${pair.paths.layout}`)
  return 0
}

const cmdValidate = async (paths: string[]): Promise<number> => {
  const targets = paths.length ? paths : ['.']
  const pairs = await expandToPairs(targets)
  if (pairs.length === 0) {
    log('no .epr.d2 diagrams found')
    return 1
  }
  let total = 0
  for (const pair of pairs) {
    const issues = await validatePair(pair)
    total += issues.length
    for (const issue of issues) process.stdout.write(formatIssue(issue) + '\n')
  }
  if (total === 0) log(`ok — ${pairs.length} diagram(s) valid`)
  return total === 0 ? 0 : 1
}

const cmdFmt = async (paths: string[]): Promise<number> => {
  if (paths.length === 0) {
    log('usage: epure fmt <file...>')
    return 1
  }
  const pairs = await expandToPairs(paths)
  let changed = 0
  for (const pair of pairs) {
    let text: string
    try {
      text = await readFile(pair.paths.layout, 'utf8')
    } catch {
      continue
    }
    const result = validateLayoutJson(text)
    if (!result.value) {
      log(`skipped ${pair.paths.layout} — invalid layout`)
      continue
    }
    const canonical = canonicalizeLayout(result.value)
    if (canonical !== text) {
      await writeFile(pair.paths.layout, canonical, 'utf8')
      changed += 1
      log(`formatted ${pair.paths.layout}`)
    }
  }
  log(`fmt: ${changed} file(s) changed`)
  return 0
}

const cmdSkillInstall = async (args: string[]): Promise<number> => {
  const src = resolve(HERE, '../skills/epure-diagram/SKILL.md')
  if (!existsSync(src)) {
    log('skill source not found in this package')
    return 1
  }
  // `--local` (a.k.a. --project/--here) installs into the current repo's
  // .claude/skills so it can be committed and shared; default is the global
  // ~/.claude/skills for every project on this machine.
  const local = args.some((a) => a === '--local' || a === '--project' || a === '--here')
  const destDir = local
    ? resolve(process.cwd(), '.claude', 'skills', 'epure-diagram')
    : join(homedir(), '.claude', 'skills', 'epure-diagram')
  await mkdir(destDir, { recursive: true })
  await copyFile(src, join(destDir, 'SKILL.md'))
  log(`installed epure-diagram skill to ${destDir}${local ? ' (this repo)' : ''}`)
  return 0
}

const cmdExport = async (args: string[]): Promise<number> => {
  let file: string | undefined
  let out: string | undefined
  let scale = 2
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '-o' || a === '--out') out = args[(i += 1)]
    else if (a === '--scale') scale = Number(args[(i += 1)]) || 2
    else if (!a.startsWith('-') && !file) file = a
  }
  if (!file) {
    log('usage: epure export <file> [-o out.png] [--scale N]')
    return 1
  }

  const pair = resolvePair(file)
  const d2 = await readFile(pair.paths.d2, 'utf8').catch(() => null)
  if (d2 === null) {
    log(`no diagram at ${pair.paths.d2}`)
    return 1
  }
  const layoutText = await readFile(pair.paths.layout, 'utf8').catch(() => null)

  // Real server-side routing needs libavoid's wasm; ship it next to the CLI.
  const wasm = resolve(HERE, 'libavoid.wasm')
  if (existsSync(wasm)) setLibavoidWasmPath(wasm)
  // Belt-and-suspenders: if wasm init still leaks a rejection, don't crash —
  // route()'s fallback produces stub routes and the export proceeds.
  const onUnhandled = (err: unknown) => {
    if (String(err).includes('wasm') || String(err).includes('libavoid')) return
    throw err
  }
  process.on('unhandledRejection', onUnhandled)

  const result = await renderDiagramPng(d2, layoutText, {
    scale,
    iconsDir: join(DIST_DIR, 'icons'),
  })
  if (!Buffer.isBuffer(result)) {
    log(`cannot render: ${result.error}`)
    return 1
  }

  const dest = resolve(out ?? join(pair.dir, `${pair.stem}.png`))
  await writeFile(dest, result)
  // One machine-readable line on stdout so CC can grab the path to view it.
  process.stdout.write(dest + '\n')
  log(`exported ${pair.stem} → ${dest} (fit to content, ${scale}×)`)
  return 0
}

// ── poll (live feedback) ──────────────────────────────────────────────────────
//
// The agent leg of the impeccable-style live toolbar. The browser submits
// feedback over the WebSocket; the server queues it; Claude Code drains it here.
// Mirrors impeccable's `live-poll.mjs`: a one-shot long-poll that prints one
// event JSON line, plus a `--reply` mode. Uses node:http directly (like the
// health probe) — no undici 300s ceiling, but we cap each request so a half-open
// socket can't hang the loop.

const POLL_SLICE_MS = 25_000
const POLL_TOTAL_MS = 600_000 // 10 min, then emit a `timeout` line so CC re-polls
/** Flags that terminate an optional trailing `--reply` message. */
const POLL_FLAGS = new Set(['--reply', '--wait', '--port'])

type PollSliceResult =
  | { kind: 'event'; value: unknown }
  | { kind: 'retry' }
  | { kind: 'gone' }

const pollSlice = (port: number, sliceMs: number): Promise<PollSliceResult> =>
  new Promise((resolvePromise) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: `/__epure/poll?timeout=${sliceMs}`,
        timeout: sliceMs + 5_000,
      },
      (res) => {
        // A non-JSON 200 means this isn't the live-feedback endpoint — almost
        // always an OLDER epure server whose SPA fallback returns index.html for
        // the unknown route. Treat it as "gone" (a clear one-line message) so we
        // never hot-loop forever JSON-parsing HTML.
        const contentType = res.headers['content-type'] ?? ''
        if (res.statusCode !== 200 || !contentType.includes('application/json')) {
          res.resume()
          resolvePromise({ kind: 'gone' })
          return
        }
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolvePromise({ kind: 'event', value: JSON.parse(body) })
          } catch {
            resolvePromise({ kind: 'retry' })
          }
        })
      },
    )
    // ECONNREFUSED means the server is gone for good; anything else is a blip.
    req.on('error', (e) =>
      resolvePromise(
        (e as NodeJS.ErrnoException).code === 'ECONNREFUSED'
          ? { kind: 'gone' }
          : { kind: 'retry' },
      ),
    )
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ kind: 'retry' })
    })
  })

const postReply = (
  port: number,
  payload: { id: string; status: 'done' | 'error'; message?: string },
): Promise<boolean> =>
  new Promise((resolvePromise) => {
    const data = JSON.stringify(payload)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/__epure/poll',
        method: 'POST',
        timeout: 5_000,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      (res) => {
        res.resume()
        resolvePromise(res.statusCode === 200)
      },
    )
    req.on('error', () => resolvePromise(false))
    req.on('timeout', () => {
      req.destroy()
      resolvePromise(false)
    })
    req.end(data)
  })

const cmdPoll = async (args: string[]): Promise<number> => {
  let file: string | undefined
  let portOverride: number | undefined
  let waitAfter = false
  let reply: { id: string; status: 'done' | 'error'; message?: string } | undefined
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--wait') {
      // With --reply: ack then long-poll for the next event in one round-trip.
      waitAfter = true
    } else if (a === '--port') {
      const raw = args[(i += 1)]
      portOverride = Number(raw)
      if (
        raw === undefined ||
        !Number.isInteger(portOverride) ||
        portOverride <= 0 ||
        portOverride > 65535
      ) {
        log('usage: epure poll <file> --port <1-65535>')
        return 1
      }
    } else if (a === '--reply') {
      const id = args[(i += 1)]
      const status = args[(i += 1)]
      if (!id || (status !== 'done' && status !== 'error')) {
        log('usage: epure poll <file> --reply <id> <done|error> [message]')
        return 1
      }
      // Optional trailing message — only when the file is already set (so a
      // bare `--reply id done mydiagram` treats `mydiagram` as the file), and
      // terminated only by a KNOWN flag (not any '--' token), so a reply message
      // that itself starts with '--' is preserved rather than silently dropped.
      let message: string | undefined
      const next = args[i + 1]
      if (file !== undefined && next !== undefined && !POLL_FLAGS.has(next)) {
        message = args[(i += 1)]
      }
      reply = { id, status, ...(message ? { message } : {}) }
    } else if (!a.startsWith('-') && !file) {
      file = a
    }
  }
  if (!file) {
    log('usage: epure poll <file> [--reply <id> <done|error> [message]] [--wait] [--port N]')
    return 1
  }

  const pair = resolvePair(file)
  let realPath: string
  try {
    realPath = realpathSync(pair.paths.d2)
  } catch {
    log(`no diagram at ${pair.paths.d2} — is the server running?`)
    return 1
  }
  const port = portOverride ?? portForPath(realPath)

  // Confirm a server is there AND that it serves THIS diagram — never poll a
  // colliding diagram's server (it would feed CC the wrong feedback).
  const occupant = await probeHealth(port)
  if (occupant === null) {
    log(
      `no Épure server reachable on port ${port}. Start it with \`epure ${file}\`. ` +
        `If it fell back to an ephemeral port, pass --port from its ready line.`,
    )
    return 1
  }
  if (occupant !== realPath) {
    log(
      `port ${port} serves a different diagram (${occupant}). ` +
        `Pass --port from this diagram's serve output.`,
    )
    return 1
  }

  if (reply) {
    if (!(await postReply(port, reply))) {
      log('reply failed — the server may have stopped')
      return 1
    }
    // --wait: keep going and long-poll for the next event below, so a single
    // foreground call acks the last note and returns the next one inline.
    if (!waitAfter) {
      process.stdout.write(JSON.stringify({ ok: true }) + '\n')
      return 0
    }
  }

  // Long-poll: loop 25s slices until a real event/exit, or emit `timeout` after
  // the total budget so the caller re-polls.
  const deadline = Date.now() + POLL_TOTAL_MS
  while (Date.now() < deadline) {
    const slice = Math.min(POLL_SLICE_MS, deadline - Date.now())
    const result = await pollSlice(port, slice)
    if (result.kind === 'gone') {
      log(
        `the Épure server on port ${port} isn't serving live feedback ` +
          `(stopped, or an older version) — restart it with \`epure ${file}\``,
      )
      return 1
    }
    if (result.kind === 'retry') {
      // A transient blip (reset, malformed body). Back off so we never hot-loop.
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    const value = result.value as { type?: string } | null
    if (value?.type === 'timeout') continue
    process.stdout.write(JSON.stringify(value) + '\n')
    return 0
  }
  process.stdout.write(JSON.stringify({ type: 'timeout' }) + '\n')
  return 0
}

// ── helpers ─────────────────────────────────────────────────────────────────

const formatIssue = (i: ValidationIssue): string =>
  i.line !== undefined
    ? `${i.file}:${i.line}:${i.column ?? 1}: ${i.message}`
    : `${i.file}: ${i.message}`

/** Expand a list of files/dirs into resolved pairs, de-duplicated by stem path. */
const expandToPairs = async (targets: string[]): Promise<ResolvedPair[]> => {
  const seen = new Set<string>()
  const pairs: ResolvedPair[] = []
  const add = (input: string) => {
    const pair = resolvePair(input)
    if (!seen.has(pair.paths.d2)) {
      seen.add(pair.paths.d2)
      pairs.push(pair)
    }
  }
  for (const target of targets) {
    const abs = resolve(process.cwd(), target)
    const info = await stat(abs).catch(() => null)
    if (info?.isDirectory()) {
      const { readdir } = await import('node:fs/promises')
      for (const name of await readdir(abs)) {
        if (name.endsWith(EXT.d2)) add(join(abs, name))
      }
    } else {
      add(target)
    }
  }
  return pairs
}

const cmdIcons = (args: string[], json: boolean): number => {
  let provider: string | undefined
  let limit = 200
  const queryParts: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--provider' || a === '-p') provider = args[++i]
    else if (a === '--limit' || a === '-n') limit = Number(args[++i]) || 200
    else if (!a.startsWith('-')) queryParts.push(a)
  }

  const query = queryParts.join(' ')

  if (!query && !provider) {
    if (json) {
      process.stdout.write(JSON.stringify(PROVIDERS) + '\n')
    } else {
      process.stdout.write(`${ICON_CATALOG.length} icons across ${PROVIDERS.length} providers:\n\n`)
      for (const p of PROVIDERS)
        process.stdout.write(`  ${p.key.padEnd(16)} ${p.label.padEnd(18)} ${p.count} icons\n`)
      process.stdout.write(`\nUsage: epure icons <query> [--provider <key>] [--limit <n>]\n`)
    }
    return 0
  }

  const results = searchIcons(query, { provider, limit })
  if (json) {
    process.stdout.write(JSON.stringify(results) + '\n')
  } else {
    if (results.length === 0) {
      process.stdout.write('no icons found\n')
      return 1
    }
    for (const m of results)
      process.stdout.write(`${m.id.padEnd(52)} ${m.name}\n`)
    if (results.length >= limit)
      process.stdout.write(`\n(limited to ${limit} — use --limit or narrow the query)\n`)
  }
  return 0
}

// ── dispatch ────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')
  const [first, ...rest] = args

  if (!first || first === '--help' || first === '-h') {
    process.stdout.write(
      'usage: epure <file> | new <file> | export <file> | poll <file> | validate <path...> | fmt <file...> | icons [query] | skill install\n',
    )
    process.exit(first ? 0 : 1)
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write(VERSION + '\n')
    process.exit(0)
  }

  switch (first) {
    case 'new':
      process.exit(await cmdNew(requireArg(rest[0], 'new <file>')))
      break
    case 'validate':
      process.exit(await cmdValidate(rest))
      break
    case 'fmt':
      process.exit(await cmdFmt(rest))
      break
    case 'export':
      process.exit(await cmdExport(rest))
      break
    case 'poll':
      process.exit(await cmdPoll(rest))
      break
    case 'icons':
      process.exit(cmdIcons(rest, json))
      break
    case 'skill':
      if (rest[0] !== 'install') {
        log('usage: epure skill install [--local]')
        process.exit(1)
      }
      process.exit(await cmdSkillInstall(rest))
      break
    default:
      // Default command: `epure <file>` starts the server (stays foreground).
      await serve(first, json)
  }
}

const requireArg = (value: string | undefined, usage: string): string => {
  if (!value) {
    log(`usage: epure ${usage}`)
    process.exit(1)
  }
  return value
}

main().catch((e) => {
  log(String((e as Error).stack ?? e))
  process.exit(1)
})
