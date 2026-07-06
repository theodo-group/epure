// Public entrypoint: parse(source) -> ParseResult.

import type { ILexingError, IRecognitionException, IToken } from 'chevrotain'

import type { ParseError, ParseResult, SourcePos, SourceRange } from './ast'

/** A degenerate range at the document origin, for errors with no located token
 *  (e.g. a visitor exception). */
function emptyRange(): SourceRange {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  }
}
import { lexer } from './lexer'
import { parserInstance } from './parser'
import { D2Visitor } from './visitor'

export * from './ast'

export function parse(source: string): ParseResult {
  const lexResult = lexer.tokenize(source)

  const errors: ParseError[] = lexResult.errors.map(lexErrorToParseError)

  parserInstance.input = lexResult.tokens
  const cst = parserInstance.program()

  // End-of-input position, used as the fallback when a parser error lands on the
  // EOF token — Chevrotain gives that token NaN for every position field.
  const eof = eofPos(source)
  for (const e of parserInstance.errors) {
    errors.push(parserErrorToParseError(e, eof))
  }

  // Always run the visitor — even with errors — so we can surface as many
  // problems as possible in one pass.
  const visitor = new D2Visitor()
  let diagram
  try {
    diagram = visitor.visit(cst) as ReturnType<D2Visitor['program']>
  } catch (err) {
    errors.push({
      message: (err as Error).message,
      range: emptyRange(),
    })
    return { ok: false, errors }
  }
  errors.push(...visitor.errors)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, diagram }
}

function lexErrorToParseError(e: ILexingError): ParseError {
  const line = e.line ?? 1
  const column = e.column ?? 1
  const offset = e.offset ?? 0
  const length = e.length ?? 1
  return {
    message: e.message,
    range: {
      start: { line, column, offset },
      end: { line, column: column + length, offset: offset + length },
    },
  }
}

function parserErrorToParseError(
  e: IRecognitionException,
  eof: SourcePos,
): ParseError {
  // The error token can be missing (no token) OR the EOF token, whose position
  // fields are all NaN. `?? 1` doesn't catch NaN, so every field is sanitized
  // through `finite`, falling back to the end-of-input position — otherwise a
  // NaN line reaches the editor and crashes `doc.line(NaN)` on the next render.
  const tok: IToken | undefined = e.token
  const startLine = finite(tok?.startLine, eof.line)
  const startColumn = finite(tok?.startColumn, eof.column)
  const startOffset = finite(tok?.startOffset, eof.offset)
  return {
    message: e.message,
    range: {
      start: { line: startLine, column: startColumn, offset: startOffset },
      end: {
        line: finite(tok?.endLine, startLine),
        column: finite(tok?.endColumn, startColumn) + 1,
        offset: finite(tok?.endOffset, startOffset) + 1,
      },
    },
  }
}

/** Return `v` when it is a real finite number, else `fallback`. Unlike `??`,
 *  this also rejects NaN (Chevrotain's EOF token positions). */
function finite(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Position just past the last character of the source (1-based line/column,
 *  0-based offset), where an "expecting more input" error is anchored. */
function eofPos(source: string): SourcePos {
  const nl = source.split('\n')
  return {
    line: nl.length,
    column: (nl[nl.length - 1]?.length ?? 0) + 1,
    offset: source.length,
  }
}
