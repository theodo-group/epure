// Public surface for the bundled icon catalog. The heavy metadata array lives
// in catalog.generated.ts (built by scripts/build-icon-catalog.mjs); the icon
// images are static files under public/icons/ served at runtime and inlined as
// data URIs only at export time.

import { ICON_CATALOG, type IconMeta } from './catalog.generated'

export type { IconMeta }
/** Every bundled icon's metadata (~9.4k entries). */
export { ICON_CATALOG as catalog }

// Vite serves public/ at the app base path; honour a non-root base (e.g. when
// deployed under a GitHub Pages subpath).
const BASE = import.meta.env?.BASE_URL || '/'

const byId = new Map(ICON_CATALOG.map((m) => [m.id, m]))

/** The icon's metadata, or undefined for an unknown id. */
export const icon = (id: string): IconMeta | undefined => byId.get(id)

/** Static URL for an icon, by id (undefined when unknown) or by metadata. */
export function url(of: IconMeta): string
export function url(of: string): string | undefined
export function url(of: string | IconMeta): string | undefined {
  const meta = typeof of === 'string' ? byId.get(of) : of
  return meta ? `${BASE.replace(/\/$/, '')}/icons/${meta.file}` : undefined
}

export interface Provider {
  key: string
  label: string
  count: number
}

const PROVIDER_LABELS: Record<string, string> = {
  alibabacloud: 'Alibaba Cloud',
  aws: 'AWS',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
  elastic: 'Elastic',
  filetype: 'File Types',
  firebase: 'Firebase',
  fontawesome: 'Font Awesome',
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
  simpleicons: 'Brands',
  lobe: 'AI / LLM',
}

/** Providers ordered by catalog richness (most icons first). */
export const providers: Provider[] = (() => {
  const counts = new Map<string, number>()
  for (const m of ICON_CATALOG) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1)
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: PROVIDER_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
})()

const byProvider = new Map(providers.map((p) => [p.key, p]))

/** A provider by key; unknown keys resolve to a zero-count self-labeled one. */
export const provider = (key: string): Provider =>
  byProvider.get(key) ?? { key, label: key, count: 0 }

const haystack = (m: IconMeta) => `${m.id} ${m.name} ${m.provider} ${m.category}`.toLowerCase()

const HAYSTACKS = new Map(ICON_CATALOG.map((m) => [m.id, haystack(m)]))

export interface SearchOptions {
  provider?: string
  limit?: number
}

/**
 * Filter the catalog by a free-text query (matched against id/name/provider/
 * category, all terms must hit) and an optional provider, capped to `limit`.
 */
export const search = (query: string, { provider, limit = 240 }: SearchOptions = {}): IconMeta[] => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const out: IconMeta[] = []
  for (const m of ICON_CATALOG) {
    if (provider && m.provider !== provider) continue
    if (terms.length) {
      const h = HAYSTACKS.get(m.id)!
      if (!terms.every((t) => h.includes(t))) continue
    }
    out.push(m)
    if (out.length >= limit) break
  }
  return out
}
