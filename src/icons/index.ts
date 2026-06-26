// Public surface for the bundled icon catalog. The heavy metadata array lives
// in catalog.generated.ts (built by scripts/build-icon-catalog.mjs); the icon
// images are static files under public/icons/ served at runtime and inlined as
// data URIs only at export time (src/export/inlineImages.ts).

import { ICON_CATALOG, type IconMeta } from './catalog.generated'

export type { IconMeta }
export { ICON_CATALOG }

// Vite serves public/ at the app base path; honour a non-root base (e.g. when
// deployed under a GitHub Pages subpath).
const BASE = import.meta.env?.BASE_URL || '/'

/** Static URL for an icon file path (e.g. "aws/compute/ec2.png"). */
export const iconUrl = (file: string): string =>
  `${BASE.replace(/\/$/, '')}/icons/${file}`

const byId = new Map(ICON_CATALOG.map((m) => [m.id, m]))

export const iconById = (id: string): IconMeta | undefined => byId.get(id)

/** Static URL for an icon id, or undefined if the id is unknown. */
export const iconUrlById = (id: string): string | undefined => {
  const m = byId.get(id)
  return m ? iconUrl(m.file) : undefined
}

export interface ProviderInfo {
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
  simpleicons: 'Brands',
  lobe: 'AI / LLM',
}

export const providerLabel = (key: string): string =>
  PROVIDER_LABELS[key] ?? key

// Providers ordered by catalog richness (most icons first), each with a count.
export const PROVIDERS: ProviderInfo[] = (() => {
  const counts = new Map<string, number>()
  for (const m of ICON_CATALOG) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1)
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: providerLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
})()

const haystack = (m: IconMeta) =>
  `${m.id} ${m.name} ${m.provider} ${m.category}`.toLowerCase()

const HAYSTACKS = new Map(ICON_CATALOG.map((m) => [m.id, haystack(m)]))

export interface SearchOptions {
  provider?: string
  limit?: number
}

/**
 * Filter the catalog by a free-text query (matched against id/name/provider/
 * category, all terms must hit) and an optional provider, capped to `limit`.
 */
export const searchIcons = (
  query: string,
  { provider, limit = 240 }: SearchOptions = {},
): IconMeta[] => {
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
