// Cross-file validation for a diagram pair, used by `epure validate`. Goes
// beyond the per-file checks the bridge runs (`verdictFor`): it also confirms
// the layout's keys actually reference real `.d2` nodes/edges/areas, catching
// the most common drift after a hand-edit (a node renamed in the d2 but not the
// layout, or vice-versa).

import { readFile } from 'node:fs/promises'

import { parse } from '../../src/parser'
import { validateLayoutJson } from '../../src/file/layoutSchema'

import type { ResolvedPair } from './pair'

export interface ValidationIssue {
  file: string
  line?: number
  column?: number
  message: string
}

const readOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export const validatePair = async (
  pair: ResolvedPair,
): Promise<ValidationIssue[]> => {
  const issues: ValidationIssue[] = []
  const d2Text = await readOrNull(pair.paths.d2)
  const layoutText = await readOrNull(pair.paths.layout)

  if (d2Text === null) {
    issues.push({ file: pair.paths.d2, message: 'missing .epr.d2 file' })
  }

  // Parse the d2 to learn the real node/edge/area names.
  const nodeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const areaIds = new Set<string>()
  let d2Ok = false
  if (d2Text !== null) {
    const result = parse(d2Text)
    if (result.ok) {
      d2Ok = true
      for (const n of result.diagram.nodes) nodeIds.add(n.id)
      for (const e of result.diagram.edges) edgeKeys.add(`${e.source}->${e.target}`)
      for (const a of result.diagram.areas) areaIds.add(a.id)
      // Area members must name a real node or area (nested containers are
      // by-reference, so either kind is legal). A dangling member is silently
      // skipped when the area's box is computed — surface the drift here.
      for (const a of result.diagram.areas) {
        a.members.forEach((mid, i) => {
          if (nodeIds.has(mid) || areaIds.has(mid)) return
          const range = a.memberRanges[i]
          issues.push({
            file: pair.paths.d2,
            line: range?.start.line,
            column: range?.start.column,
            message: `area "${a.id}" lists member "${mid}", which is neither a node nor an area in the .epr.d2`,
          })
        })
      }
    } else {
      for (const err of result.errors) {
        issues.push({
          file: pair.paths.d2,
          line: err.range.start.line,
          column: err.range.start.column,
          message: err.message,
        })
      }
    }
  }

  if (layoutText === null) return issues // layout is optional; nothing more to check

  const layout = validateLayoutJson(layoutText)
  if (!layout.value) {
    for (const err of layout.errors) {
      issues.push({
        file: pair.paths.layout,
        line: err.range.start.line,
        column: err.range.start.column,
        message: err.message,
      })
    }
    return issues
  }

  // Cross-file checks only make sense once the d2 itself parsed cleanly.
  if (!d2Ok) return issues

  for (const id of Object.keys(layout.value.nodes)) {
    if (!nodeIds.has(id)) {
      issues.push({
        file: pair.paths.layout,
        message: `layout node "${id}" has no matching node in the .epr.d2`,
      })
    }
  }
  for (const key of Object.keys(layout.value.edges)) {
    if (!edgeKeys.has(key)) {
      issues.push({
        file: pair.paths.layout,
        message: `layout edge "${key}" has no matching edge in the .epr.d2`,
      })
    }
  }
  for (const id of Object.keys(layout.value.areas ?? {})) {
    if (!areaIds.has(id)) {
      issues.push({
        file: pair.paths.layout,
        message: `layout area "${id}" has no matching area in the .epr.d2`,
      })
    }
  }

  return issues
}
