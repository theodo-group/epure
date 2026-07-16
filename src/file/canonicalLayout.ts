// Canonical layout serializer — the single source of truth for how a
// `.epr.layout.json` is written to disk.
//
// Used by three call sites that MUST agree byte-for-byte:
//   1. the bridge write path (server/core) when applying UI edits,
//   2. the UI outbound write (Phase 2),
//   3. `epure fmt` (CLI).
//
// It is also load-bearing for echo suppression: the bridge compares
// `canonical(parse(disk))` against `canonical(parse(lastWritten))` to tell a
// real edit from its own write bouncing back. That only works if `canonical`
// is a *fixed point* — `canonical(parse(canonical(x))) === canonical(x)` — so
// formatting differences (key order, whitespace, optional omission) can never
// masquerade as a semantic change and reopen the sync loop.
//
// Determinism guarantees:
//   - record keys (node/edge/area ids) emitted in lexicographic order, built
//     manually so numeric-looking ids never get reordered by JS object rules,
//   - fields within each record emitted in a fixed order,
//   - absent optionals omitted entirely (never `null`),
//   - numbers round-trip verbatim via JSON.stringify: gridSize is an int, and
//     cx/cy/w/h may be fractional (an odd-spanned node resized against the grid
//     centers on a half/quarter unit) but a value like 1.5 stringifies to "1.5"
//     stably, so the fixed-point property still holds,
//   - exactly one trailing newline.

import type { LayoutSidecar } from '@/layout/types'

// Field order within a node record: geometry first, then style.
const NODE_FIELD_ORDER = [
  'cx', 'cy', 'w', 'h',
  'textSize', 'textColor', 'borderColor', 'borderStyle', 'fillColor',
  'shape', 'icon', 'iconPosition',
] as const

const EDGE_FIELD_ORDER = [
  'sourceSide', 'targetSide',
  'color', 'lineStyle', 'width', 'startCap', 'endCap',
  'labelDx', 'labelDy',
] as const

const AREA_FIELD_ORDER = [
  'borderColor', 'borderStyle', 'fillColor',
] as const

const isPresent = (v: unknown): boolean => v !== undefined && v !== null

// Emit `{ "k": v, ... }` inline with fields in the given order, skipping
// absent optionals. Returns `{}` when nothing is present.
const inlineFields = (record: object, order: readonly string[]): string => {
  const fields = record as Record<string, unknown>
  const parts: string[] = []
  for (const key of order) {
    const value = fields[key]
    if (isPresent(value)) {
      parts.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    }
  }
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`
}

// Emit a keyed map (`nodes`/`edges`/`areas`) one record per line, ids sorted.
const keyedMap = (
  map: Record<string, object> | undefined,
  order: readonly string[],
): string => {
  const ids = Object.keys(map ?? {}).sort()
  if (ids.length === 0) return '{}'
  const lines = ids.map(
    (id) => `    ${JSON.stringify(id)}: ${inlineFields(map![id]!, order)}`,
  )
  return `{\n${lines.join(',\n')}\n  }`
}

/**
 * Serialize a layout sidecar to its canonical on-disk form. Pure; no I/O.
 * The result always ends in a single newline.
 */
export const canonicalizeLayout = (layout: LayoutSidecar): string => {
  const lines: string[] = ['{']
  lines.push(`  "gridSize": ${JSON.stringify(layout.gridSize)},`)
  lines.push(`  "nodes": ${keyedMap(layout.nodes, NODE_FIELD_ORDER)},`)

  // `edges` is the last required field; `areas` (optional) trails it only when
  // non-empty, so its presence/absence is itself a fixed point.
  const hasAreas = layout.areas && Object.keys(layout.areas).length > 0
  lines.push(`  "edges": ${keyedMap(layout.edges, EDGE_FIELD_ORDER)}${hasAreas ? ',' : ''}`)
  if (hasAreas) {
    lines.push(`  "areas": ${keyedMap(layout.areas, AREA_FIELD_ORDER)}`)
  }

  lines.push('}')
  return lines.join('\n') + '\n'
}
