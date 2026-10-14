// Every error message the parser can emit, in one place.
//
// They surface verbatim in the editor gutter, the footer, `epure validate`,
// the bridge's `line:col message` frames and downstream tools, so they are
// written for the person editing the file: what is wrong, in the file's own
// terms, with the offending source quoted in backticks. Each is one line (the
// gutter joins a line's messages with ` · `) and carries no position — the
// range already points at the offending token.

import { SHAPE_NAMES } from './ast'
import type { Token } from './lexer'

/** Source text quoted for a message: in backticks (single quotes when the
 *  text holds a backtick itself), cut short past 24 characters. */
export const code = (text: string): string => {
  const chars = [...text]
  const shown = chars.length > 24 ? `${chars.slice(0, 20).join('')}…` : text
  return shown.includes('`') ? `'${shown}'` : `\`${shown}\``
}

/** `, found `x`` for a real token; nothing at the end of a line or the file,
 *  where "expected …" already says it all. */
const found = (token: Token | undefined): string =>
  token && token.kind !== 'Newline' ? `, found ${code(token.image)}` : ''

const ARROW_KINDS: readonly string[] = ['ArrowRight', 'ArrowLeft', 'ArrowBoth', 'DashDash']
export const isArrow = (token: Token | undefined): boolean =>
  token !== undefined && ARROW_KINDS.includes(token.kind)

// -- lexer --------------------------------------------------------------------

// Letters, digits, punctuation and symbols read fine between backticks; a
// stray space, control, format or combining character would be invisible, so
// those are spelled as code points (`U+FEFF`, `U+00A0`, `U+0301`).
const VISIBLE = /^[\p{L}\p{N}\p{P}\p{S}]+$/u
const codePoint = (c: string): string =>
  `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

/** A run of characters no token can start with. A lone quote is a string the
 *  lexer could not close on its line. */
export const unexpectedCharacters = (run: string): string => {
  const first = run.charAt(0)
  if (first === '"' || first === "'") return `Unterminated string — add a closing ${code(first)}`
  const chars = [...run]
  const what = chars.length === 1 ? 'character' : 'characters'
  const shown = VISIBLE.test(run) ? code(run) : chars.map(codePoint).join(' ')
  return `Unexpected ${what} ${shown}`
}

// -- parser -------------------------------------------------------------------

/** A statement can't start with `token` (it is at the start of a line). */
export const expectedStatement = (token: Token): string => {
  if (token.kind === 'RCurly') return 'Unexpected `}` — no block is open'
  if (token.kind === 'Semicolon') return 'Unexpected `;` outside a block'
  if (isArrow(token) || token.kind === 'Colon' || token.kind === 'LCurly') {
    return `Expected a node id before ${code(token.image)}`
  }
  if (token.kind === 'StringLit') return `Expected a node id${found(token)} — ids are not quoted`
  if (token.kind === 'NumberLit') {
    return `Expected a node id${found(token)} — ids start with a letter or \`_\``
  }
  return `Expected a node id${found(token)}`
}

/** What ended the previous statement on the same line, for `unexpectedAfter`. */
export type StatementEnd = 'unquotedLabel' | 'edgeTarget' | 'id' | 'other'

/** `token` follows a complete statement on the same line. */
export const unexpectedAfter = (token: Token, end: StatementEnd): string => {
  if (token.kind === 'RCurly') return 'Unexpected `}` — no block is open'
  if (token.kind === 'Semicolon') return 'Unexpected `;` outside a block'
  if (end === 'unquotedLabel') {
    return `Unexpected ${code(token.image)} in an unquoted label — wrap the label in quotes`
  }
  if (end === 'edgeTarget' && isArrow(token)) {
    return "Edge chains aren't supported — write one edge per line"
  }
  if (end !== 'other' && token.kind === 'StringLit') {
    return `Expected \`:\` before the label ${code(token.image)}`
  }
  if (end !== 'other' && token.kind === 'Dot') return "Unexpected `.` — ids can't contain dots"
  return `Unexpected ${code(token.image)}`
}

/** No label after `head:` (`head` is `api` or `a -> b`). */
export const expectedLabel = (head: string, token: Token | undefined): string => {
  const expected = `Expected a label after ${code(`${head}:`)}`
  if (token?.kind === 'NumberLit') return `${expected} — quote labels that start with a digit`
  if (token?.kind === 'LCurly') return `${expected} — drop the \`:\` to open a block directly`
  return `${expected}${found(token)}`
}

/** An edge with no target after its arrow. */
export const expectedTarget = (arrow: Token, token: Token | undefined): string =>
  `Expected a node id after ${code(arrow.image)}${found(token)}`

/** `path.` with no segment after the dot. */
export const expectedAttrName = (path: string, token: Token | undefined): string =>
  `Expected an attribute name after ${code(`${path}.`)}${found(token)}`

/** An attribute path with no `:` after it. In an edge block, a bare word is
 *  most likely a member written where only attributes go. */
export const expectedAttrColon = (
  path: string,
  token: Token | undefined,
  inEdgeBlock: boolean,
): string =>
  inEdgeBlock && !path.includes('.')
    ? `Expected \`:\` after ${code(path)} — edge blocks only hold attributes`
    : `Expected \`:\` after ${code(path)}${found(token)}`

/** `path:` with no value. */
export const expectedAttrValue = (path: string, token: Token | undefined): string =>
  `Expected a value after ${code(`${path}:`)}${found(token)}`

/** A block whose items stop at `token` instead of its closing `}`. `owner` is
 *  the node/area id or the edge (`a -> b`); `ownsMembers` is false for edges. */
export const unclosedBlock = (
  owner: string,
  ownsMembers: boolean,
  token: Token | undefined,
): string => {
  if (!token) return `Expected \`}\` to close the ${code(owner)} block`
  if (token.kind === 'LCurly') {
    return ownsMembers
      ? `Unexpected \`{\` — blocks can't nest; declare it at top level and list its id in ${code(owner)}`
      : "Unexpected `{` — blocks can't nest"
  }
  if (isArrow(token)) {
    return `Unexpected ${code(token.image)} in the ${code(owner)} block — edges go at top level`
  }
  return `Unexpected ${code(token.image)} in the ${code(owner)} block`
}

// -- semantic checks (build) ------------------------------------------------

export const duplicateId = (id: string, firstLine: number): string =>
  `Duplicate id ${code(id)} — first declared on line ${firstLine}`

const SHAPES = `${SHAPE_NAMES.slice(0, -1).join(', ')} or ${SHAPE_NAMES[SHAPE_NAMES.length - 1]}`

/** `value` is unquoted (`shape: ""` gives `''`, shown as `""`). */
export const unknownShape = (value: string, id: string): string =>
  `Unknown shape ${code(value || '""')} on ${code(id)} — use ${SHAPES}`

export const unsupportedDottedAttr = (path: string, owner: string): string =>
  `Unsupported dotted attribute ${code(path)} on ${code(owner)}`

export const mixedBlock = (id: string): string =>
  `Block ${code(id)} mixes attributes and members — an area lists only member ids`

export const duplicateMember = (area: string, member: string): string =>
  `Area ${code(area)} already lists ${code(member)}`

export const selfMember = (area: string): string => `Area ${code(area)} can't contain itself`

export const membershipCycle = (area: string, member: string): string =>
  `Membership cycle — ${code(area)} contains ${code(member)}, which already contains ${code(area)}`
