// `epure` CLI — the single entry users (and Claude Code) invoke.
//
//   epure <file>              start the live bridge server (default)
//   epure new <file>          scaffold a new pair from a seed (won't clobber)
//   epure export <file>       render a fit-to-content PNG (so Claude Code can see it)
//   epure source <file.png>   recover the .epr.d2/.epr.layout.json source a PNG embeds
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
import { get } from 'node:http'
import { mkdir, copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { canonicalizeLayout } from '../src/file/canonicalLayout'
import { validateLayoutJson } from '../src/file/layoutSchema'
import { setLibavoidWasmPath } from '../src/layout/elk'
import type { LayoutSidecar } from '../src/layout/types'

import { catalog, providers, search } from '../src/icons'
import { resolvePair, type ResolvedPair, EXT } from '../server/core/pair'
import { portForPath } from '../server/core/port'
import { validatePair, type ValidationIssue } from '../server/core/validate'
import { png, source } from '../server/render'
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

  const result = await png(d2, layoutText, {
    scale,
    icons: join(DIST_DIR, 'icons'),
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

// Recover the diagram source that `epure export` / the live server embed in
// every PNG. Hand this command any Épure-rendered `.png` and it prints (or
// rewrites to disk) the editable `.epr.d2` / `.epr.layout.json` pair — the
// bridge from "here's a picture" back to "here's the source, edit it in Épure".
const cmdSource = async (args: string[]): Promise<number> => {
  let file: string | undefined
  let outStem: string | undefined
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '-o' || a === '--out') outStem = args[(i += 1)]
    else if (!a.startsWith('-') && !file) file = a
  }
  if (!file) {
    log('usage: epure source <file.png> [-o <name>]   # -o writes the .epr.d2/.epr.layout.json pair')
    return 1
  }

  const bytes = await readFile(file).catch(() => null)
  if (bytes === null) {
    log(`no file at ${file}`)
    return 1
  }
  const recovered = source(bytes)
  if (recovered === null) {
    log(`${file}: no embedded Épure source (was it rendered by Épure?)`)
    return 1
  }
  const { d2, layout } = recovered

  // `-o <name>`: reconstruct the editable pair on disk so it can be opened live.
  if (outStem) {
    const pair = resolvePair(outStem)
    await writeFile(pair.paths.d2, d2)
    if (layout !== null) await writeFile(pair.paths.layout, layout)
    // Machine-readable: the .epr.d2 path, ready to hand to `epure <file>`.
    process.stdout.write(pair.paths.d2 + '\n')
    log(`recovered ${pair.stem} → ${pair.paths.d2}${layout !== null ? ` (+ layout)` : ''}`)
    return 0
  }

  // Otherwise print the d2 topology to stdout; note the layout's availability.
  process.stdout.write(d2.endsWith('\n') ? d2 : d2 + '\n')
  if (layout !== null) {
    log('(layout also embedded — pass `-o <name>` to write the full .epr.* pair)')
  }
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
      process.stdout.write(JSON.stringify(providers) + '\n')
    } else {
      process.stdout.write(`${catalog.length} icons across ${providers.length} providers:\n\n`)
      for (const p of providers)
        process.stdout.write(`  ${p.key.padEnd(16)} ${p.label.padEnd(18)} ${p.count} icons\n`)
      process.stdout.write(`\nUsage: epure icons <query> [--provider <key>] [--limit <n>]\n`)
    }
    return 0
  }

  const results = search(query, { provider, limit })
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
      'usage: epure <file> | new <file> | export <file> | source <file.png> | validate <path...> | fmt <file...> | icons [query] | skill install\n',
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
    case 'source':
      process.exit(await cmdSource(rest))
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
