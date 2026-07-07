// Build the bundled icon catalog from three sources, merged into one catalog:
//   1. mingrammer/diagrams — cloud / on-prem / k8s PNGs (largest set)
//   2. simple-icons — ~3.2k brand SVGs, recoloured with each brand's hex
//   3. @lobehub/icons-static-svg — AI/LLM brand SVGs (colour variant preferred)
//
// For every source file this script writes the processed asset to
// `public/icons/<provider>/<category>/<name>.<ext>` and records
// `{ id, name, provider, category, file }` metadata.
//
// The metadata is emitted to `src/icons/catalog.generated.ts` — a small,
// eagerly-loadable index (no image bytes). The icon image itself is served as a
// static file from `public/icons/...` at runtime, and inlined as a data URI
// only at export time (see src/export/inlineImages.ts).
//
// Mingrammer source: a checkout of https://github.com/mingrammer/diagrams.
// Point ICON_SRC at its `resources/` directory (default: /tmp/diagrams/resources).
// To refresh:
//   git clone --depth 1 https://github.com/mingrammer/diagrams /tmp/diagrams
//   node scripts/build-icon-catalog.mjs

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const SRC = process.env.ICON_SRC || '/tmp/diagrams/resources'
const OUT_DIR = path.join(ROOT, 'public', 'icons')
const OUT_TS = path.join(ROOT, 'src', 'icons', 'catalog.generated.ts')
const MAX_PX = 96
const CONCURRENCY = 8

// Tokens rendered fully uppercase in humanized display names.
const ACRONYMS = new Set(
  (
    'aws gcp oci ibm k8s k3s ec2 ec2a s3 rds sns sqs sqs vpc vpn ebs efs ecs eks ' +
    'ecr elb iam kms waf dns cdn api sql ml ai db vm os ip lb nat nacl acl sso ' +
    'mfa hsm sts ad cli etl ci cd qldb emr msk gpu cpu dax ssd hdd jwt saml ' +
    'oauth http https tcp udp grpc rest ddos hpc vdi iot ar vr nfv cdn pdns ' +
    'dms ses sso waf xr llm rpa'
  ).split(/\s+/),
)

const TITLE = {
  alibabacloud: 'Alibaba Cloud',
  aws: 'AWS',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
  elastic: 'Elastic',
  firebase: 'Firebase',
  gcp: 'GCP',
  generic: 'Generic',
  gis: 'GIS',
  ibm: 'IBM',
  k8s: 'Kubernetes',
  oci: 'Oracle Cloud',
  onprem: 'On-Prem',
  openstack: 'OpenStack',
  outscale: 'Outscale',
  programming: 'Programming',
  saas: 'SaaS',
  fontawesome: 'Font Awesome',
  brand: 'Brands',
  ai: 'AI / LLM',
  filetype: 'File Types',
}

const humanize = (base) =>
  base
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
      out.push(full)
  }
  return out
}

async function pool(items, worker, concurrency) {
  let i = 0
  let done = 0
  const total = items.length
  const runners = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (i < total) {
      const idx = i++
      await worker(items[idx], idx)
      done++
      if (done % 200 === 0) process.stdout.write(`  …${done}/${total}\n`)
    }
  })
  await Promise.all(runners)
}

// Generate brand SVGs from the `simple-icons` npm package. Each icon ships as
// a single `<path>` plus a brand hex; we wrap them in a self-contained <svg>
// with the hex baked into `fill=` so the file renders coloured by default
// (matching the existing mingrammer aesthetic of full-colour logos).
async function buildSimpleIcons(meta) {
  const siModule = await import('simple-icons')
  const all = siModule.default ?? siModule
  const provider = 'simpleicons'
  const category = 'brand'
  const dir = path.join(OUT_DIR, provider, category)
  await fs.mkdir(dir, { recursive: true })

  let count = 0
  for (const key of Object.keys(all)) {
    const icon = all[key]
    if (!icon || typeof icon !== 'object' || !icon.slug || !icon.path) continue
    const fill = `#${icon.hex || '000000'}`
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
      `<title>${escapeXml(icon.title)}</title>` +
      `<path fill="${fill}" d="${icon.path}"/></svg>`
    const file = `${provider}/${category}/${icon.slug}.svg`
    await fs.writeFile(path.join(OUT_DIR, file), svg)
    meta.push({
      id: `${provider}/${category}/${icon.slug}`,
      name: icon.title,
      provider,
      category,
      file,
    })
    count++
  }
  console.log(`Simple Icons: wrote ${count} brand SVGs.`)
}

// Generate AI/LLM brand SVGs from `@lobehub/icons-static-svg`. The package
// ships three variants per brand: plain (monochrome, currentColor), -color
// (full colour), and -text (logo + wordmark). For diagram nodes we want the
// coloured logomark, so prefer `<name>-color.svg` when available, fall back to
// `<name>.svg` (recoloured to black) otherwise, and skip `-text` wordmarks.
async function buildLobeIcons(meta) {
  const provider = 'lobe'
  const category = 'ai'
  const srcDir = path.join(
    ROOT,
    'node_modules',
    '@lobehub',
    'icons-static-svg',
    'icons',
  )
  const destDir = path.join(OUT_DIR, provider, category)
  await fs.mkdir(destDir, { recursive: true })

  const files = (await fs.readdir(srcDir))
    .filter((f) => f.endsWith('.svg') && !f.endsWith('-text.svg'))
    .sort()

  // Group by base name; prefer the -color variant.
  const chosen = new Map()
  for (const f of files) {
    const base = f.replace(/(-color)?\.svg$/, '')
    const isColor = f.endsWith('-color.svg')
    const cur = chosen.get(base)
    if (!cur || (isColor && !cur.isColor)) chosen.set(base, { file: f, isColor })
  }

  let count = 0
  for (const [base, { file, isColor }] of chosen) {
    let svg = await fs.readFile(path.join(srcDir, file), 'utf8')
    if (!isColor) {
      // The plain variant uses fill="currentColor", which doesn't resolve when
      // the SVG is loaded through <image>/<img>. Bake in black so the logo is
      // visible on the white badge chip.
      svg = svg.replace(/fill="currentColor"/g, 'fill="#000000"')
    }
    const slug = base
    const outFile = `${provider}/${category}/${slug}.svg`
    await fs.writeFile(path.join(OUT_DIR, outFile), svg)
    meta.push({
      id: `${provider}/${category}/${slug}`,
      name: humanize(slug),
      provider,
      category,
      file: outFile,
    })
    count++
  }
  console.log(`Lobe Icons: wrote ${count} AI/LLM SVGs.`)
}

// Generate the full Font Awesome Free catalog from `@fortawesome/fontawesome-free`.
// The package ships self-contained, monochrome SVGs under svgs/{solid,regular,
// brands}/. Every glyph uses fill="currentColor", which renders invisible when
// loaded through <image>/<img> (same gotcha as the plain Lobe variant), so we
// bake in black before writing. The attribution comment FA embeds in each SVG
// is preserved verbatim, satisfying the CC-BY-4.0 icon licence.
async function buildFontAwesome(meta) {
  const provider = 'fontawesome'
  const styles = ['solid', 'regular', 'brands']
  const srcRoot = path.join(
    ROOT,
    'node_modules',
    '@fortawesome',
    'fontawesome-free',
    'svgs',
  )

  let count = 0
  for (const style of styles) {
    const srcDir = path.join(srcRoot, style)
    const destDir = path.join(OUT_DIR, provider, style)
    await fs.mkdir(destDir, { recursive: true })

    const files = (await fs.readdir(srcDir))
      .filter((f) => f.endsWith('.svg'))
      .sort()

    for (const f of files) {
      const slug = path.basename(f, '.svg')
      const svg = (await fs.readFile(path.join(srcDir, f), 'utf8')).replace(
        /currentColor/g,
        '#000000',
      )
      const file = `${provider}/${style}/${slug}.svg`
      await fs.writeFile(path.join(OUT_DIR, file), svg)
      meta.push({
        id: `${provider}/${style}/${slug}`,
        name: humanize(slug),
        provider,
        category: style,
        file,
      })
      count++
    }
  }
  console.log(`Font Awesome: wrote ${count} SVGs.`)
}

// Normalize a colour to `#rrggbb`, expanding `#rgb` shorthand and falling back
// to a neutral slate for anything unparseable.
const normalizeHex = (c) => {
  const s = String(c || '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return '#607d8b'
}

// Pick a readable text colour (near-black or white) for a filled band of the
// given hex, using perceived luminance so pale bands (e.g. JS yellow) get dark
// text and dark bands get white.
const contrastText = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#1f2937' : '#ffffff'
}

// Render one file-type badge: a folded-corner document (white body, colour-
// tinted dog-ear) with a colour footer band carrying the uppercase extension
// label. Square 48×48 viewBox so it centres in both the corner-badge chip and
// the top-icon slot. Uses explicit fills and a web-safe font stack because the
// SVG is loaded through <img>/<image> (currentColor and app fonts don't apply).
const filetypeSvg = ({ label, color }) => {
  const fg = contrastText(color)
  const len = label.length
  const fontSize = len <= 1 ? 16 : len === 2 ? 15 : len === 3 ? 13 : 10.5
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    // Page body with a cut top-right corner.
    `<path d="M12 4H32L40 12V42Q40 44 38 44H12Q10 44 10 42V6Q10 4 12 4Z" ` +
    `fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" stroke-linejoin="round"/>` +
    // Folded-corner flap (the "back" of the page), tinted with the file colour.
    `<path d="M32 4V12H40Z" fill="${color}" fill-opacity="0.4" stroke="#cbd5e1" stroke-width="1" stroke-linejoin="round"/>` +
    // Colour footer band, flush to the rounded bottom of the page.
    `<path d="M10 28H40V42Q40 44 38 44H12Q10 44 10 42Z" fill="${color}"/>` +
    // Uppercase extension label, centred in the band.
    `<text x="25" y="36.5" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" ` +
    `fill="${fg}" letter-spacing="${len <= 2 ? 0.5 : 0}">${escapeXml(label)}</text>` +
    `</svg>`
  )
}

// Build the file-type badge provider from the committed registry
// (scripts/filetype-icons.json): one clean SVG per standard file extension,
// grouped by category (code, web, data, document, image, audio, video,
// archive, config, database, font, binary, …). Regenerate on its own with:
//   ICON_ONLY=filetype node scripts/build-icon-catalog.mjs
async function buildFiletypes(meta) {
  const provider = 'filetype'
  const registry = JSON.parse(
    await fs.readFile(path.join(ROOT, 'scripts', 'filetype-icons.json'), 'utf8'),
  )

  // Start clean so removed/renamed entries don't leave orphan files behind.
  await fs.rm(path.join(OUT_DIR, provider), { recursive: true, force: true })

  let count = 0
  const seen = new Set()
  for (const raw of registry) {
    const ext = String(raw.ext || '').toLowerCase().trim()
    if (!/^[a-z0-9]+$/.test(ext) || seen.has(ext)) continue
    seen.add(ext)
    const category = String(raw.category || 'other').toLowerCase()
    const label = String(raw.label || ext).toUpperCase().slice(0, 4)
    const color = normalizeHex(raw.color)
    const name = raw.name || humanize(ext)

    const file = `${provider}/${category}/${ext}.svg`
    await fs.mkdir(path.join(OUT_DIR, provider, category), { recursive: true })
    await fs.writeFile(path.join(OUT_DIR, file), filetypeSvg({ label, color }))
    meta.push({ id: `${provider}/${category}/${ext}`, name, provider, category, file })
    count++
  }
  console.log(`File Types: wrote ${count} SVGs.`)
}

const escapeXml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Build the mingrammer/diagrams PNG providers (cloud, on-prem, k8s, …). This
// wipes public/icons first, so it must run before the generated SVG providers.
async function buildMingrammer(meta) {
  await fs.access(SRC).catch(() => {
    throw new Error(
      `Icon source not found: ${SRC}\nClone it first:\n  git clone --depth 1 https://github.com/mingrammer/diagrams /tmp/diagrams`,
    )
  })

  const allPngs = (await walk(SRC)).sort()
  const relSet = new Set(allPngs.map((p) => path.relative(SRC, p)))

  // Drop "-rounded" duplicates when the un-rounded variant exists — they are
  // visually redundant and only inflate the catalog.
  const kept = allPngs.filter((p) => {
    const rel = path.relative(SRC, p)
    if (rel.endsWith('-rounded.png')) {
      const base = rel.replace(/-rounded\.png$/, '.png')
      if (relSet.has(base)) return false
    }
    return true
  })

  console.log(`Found ${allPngs.length} PNGs, keeping ${kept.length} after dedupe.`)
  await fs.rm(OUT_DIR, { recursive: true, force: true })

  await pool(
    kept,
    async (srcPath) => {
      const rel = path.relative(SRC, srcPath) // e.g. aws/compute/ec2.png
      const segs = rel.split(path.sep)
      const provider = segs[0]
      const base = path.basename(rel, '.png')
      // Provider cover image lives at <provider>/<provider>.png (2 segments);
      // everything else is <provider>/<category>/<name>.png.
      const category = segs.length >= 3 ? segs[1] : provider
      const id = rel.slice(0, -'.png'.length).split(path.sep).join('/')
      const name =
        segs.length >= 3 ? humanize(base) : TITLE[provider] || humanize(base)

      const dest = path.join(OUT_DIR, rel)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await execFileP('sips', ['-Z', String(MAX_PX), srcPath, '--out', dest], {
        maxBuffer: 1 << 24,
      })
      // Quantize to an 8-bit palette to shrink the file (typically 50-70%
      // smaller). pngquant exits non-zero and leaves `dest` untouched when it
      // can't hit the quality floor — that's fine, we keep the sips output.
      await execFileP('pngquant', [
        '--quality=55-90',
        '--strip',
        '--skip-if-larger',
        '--force',
        '--output',
        dest,
        '--',
        dest,
      ]).catch(() => {})

      meta.push({ id, name, provider, category, file: rel.split(path.sep).join('/') })
    },
    CONCURRENCY,
  )

}

// Regeneratable providers — assets are generated rather than sourced from the
// mingrammer PNGs, so each can be rebuilt on its own via ICON_ONLY=<provider>.
const GENERATED_PROVIDERS = {
  simpleicons: buildSimpleIcons,
  lobe: buildLobeIcons,
  fontawesome: buildFontAwesome,
  filetype: buildFiletypes,
}

// Recover the committed catalog so a single-provider rebuild can keep every
// other provider's entries without re-running the heavy mingrammer pipeline.
async function readExistingCatalog() {
  const text = await fs.readFile(OUT_TS, 'utf8')
  // The catalog is serialized as a single `[{…},{…}]` line, so it uniquely
  // starts with `[{` and ends with `}]` (the `IconMeta[]` type annotation has
  // an empty `[]` that must not be matched).
  const start = text.indexOf('[{')
  const end = text.lastIndexOf('}]') + 2
  return JSON.parse(text.slice(start, end))
}

async function main() {
  const meta = []

  // Incremental mode: rebuild just one generated provider (e.g. Font Awesome),
  // reusing the committed catalog for everything else — no mingrammer checkout
  // and no re-quantizing thousands of PNGs:
  //   ICON_ONLY=fontawesome node scripts/build-icon-catalog.mjs
  const only = process.env.ICON_ONLY
  if (only) {
    const build = GENERATED_PROVIDERS[only]
    if (!build)
      throw new Error(
        `ICON_ONLY=${only} is not a regeneratable provider (one of: ${Object.keys(
          GENERATED_PROVIDERS,
        ).join(', ')})`,
      )
    for (const m of await readExistingCatalog())
      if (m.provider !== only) meta.push(m)
    await build(meta)
  } else {
    await buildMingrammer(meta)
    await buildSimpleIcons(meta)
    await buildLobeIcons(meta)
    await buildFontAwesome(meta)
    await buildFiletypes(meta)
  }

  meta.sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name),
  )

  const header = `// AUTO-GENERATED by scripts/build-icon-catalog.mjs — do not edit by hand.
// Sources: mingrammer/diagrams (cloud/on-prem PNGs, ${MAX_PX}px), simple-icons
// (brand SVGs), @lobehub/icons-static-svg (AI/LLM SVGs), Font Awesome Free
// (@fortawesome/fontawesome-free — solid/regular/brands SVGs) and the
// file-type badge set generated from scripts/filetype-icons.json.
// ${meta.length} icons. Regenerate with: node scripts/build-icon-catalog.mjs

export interface IconMeta {
  /** Stable id, e.g. "aws/compute/ec2". Stored in the layout JSON. */
  id: string
  /** Humanized display name. */
  name: string
  /** Top-level provider key, e.g. "aws". */
  provider: string
  /** Sub-category, e.g. "compute". */
  category: string
  /** Path under public/icons/, e.g. "aws/compute/ec2.png". */
  file: string
}

export const ICON_CATALOG: IconMeta[] = ${JSON.stringify(meta, null, 0)}
`

  await fs.mkdir(path.dirname(OUT_TS), { recursive: true })
  await fs.writeFile(OUT_TS, header)

  // Report output size.
  let bytes = 0
  for (const m of meta) bytes += (await fs.stat(path.join(OUT_DIR, m.file))).size
  console.log(
    `Wrote ${meta.length} icons → public/icons (${(bytes / 1e6).toFixed(1)} MB) ` +
      `and ${path.relative(ROOT, OUT_TS)} (${(header.length / 1024).toFixed(0)} KB).`,
  )
  const byProv = {}
  for (const m of meta) byProv[m.provider] = (byProv[m.provider] || 0) + 1
  console.log('Per provider:', JSON.stringify(byProv))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
