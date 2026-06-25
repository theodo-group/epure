// Parse + canonical-serialize the comments sidecar. Like the layout serializer,
// the canonical form is a fixed point so the bridge's echo suppression works
// (UI writes and CC's hand-edits converge to identical bytes) and git diffs stay
// minimal. Comments are ordered by `createdAt` then `id` for stability.

import type { EprComment } from './types'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const asComment = (v: unknown): EprComment | null => {
  if (!isObj(v)) return null
  if (typeof v.id !== 'string' || typeof v.body !== 'string') return null
  const status = v.status === 'resolved' ? 'resolved' : 'open'
  const t = isObj(v.target) ? v.target : {}
  return {
    id: v.id,
    body: v.body,
    status,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    ...(v.author === 'claude' || v.author === 'user' ? { author: v.author } : {}),
    target: {
      ...(typeof t.ref === 'string' ? { ref: t.ref } : {}),
      x: typeof t.x === 'number' ? t.x : 0,
      y: typeof t.y === 'number' ? t.y : 0,
    },
  }
}

/** Parse the sidecar text. Returns [] for absent/garbage rather than throwing. */
export const parseComments = (text: string | null): EprComment[] => {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = isObj(raw) && Array.isArray(raw.comments) ? raw.comments : []
  return list.map(asComment).filter((c): c is EprComment => c !== null)
}

const sortComments = (comments: EprComment[]): EprComment[] =>
  [...comments].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )

const emitTarget = (t: EprComment['target']): string => {
  const parts: string[] = []
  if (t.ref !== undefined) parts.push(`"ref": ${JSON.stringify(t.ref)}`)
  parts.push(`"x": ${JSON.stringify(t.x)}`)
  parts.push(`"y": ${JSON.stringify(t.y)}`)
  return `{ ${parts.join(', ')} }`
}

const emitComment = (c: EprComment): string => {
  const lines = [
    `      "id": ${JSON.stringify(c.id)}`,
    `      "body": ${JSON.stringify(c.body)}`,
    `      "status": ${JSON.stringify(c.status)}`,
    `      "createdAt": ${JSON.stringify(c.createdAt)}`,
  ]
  if (c.author) lines.push(`      "author": ${JSON.stringify(c.author)}`)
  lines.push(`      "target": ${emitTarget(c.target)}`)
  return `    {\n${lines.join(',\n')}\n    }`
}

/** Canonical on-disk form. Always ends in a single newline. */
export const serializeComments = (comments: EprComment[]): string => {
  const sorted = sortComments(comments)
  const body = sorted.length
    ? `\n${sorted.map(emitComment).join(',\n')}\n  `
    : ''
  return `{\n  "version": 1,\n  "comments": [${body}]\n}\n`
}
