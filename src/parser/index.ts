// Public entrypoint: parse(source) -> ParseResult.

import type { ParseError, ParseResult, SourcePos } from './ast'
import { buildDiagram } from './build'
import { type LexError, tokenize } from './lexer'
import { parseTokens, type SyntaxIssue } from './parser'

export * from './ast'

export function parse(source: string): ParseResult {
  const lexResult = tokenize(source)

  const errors: ParseError[] = lexResult.errors.map(lexErrorToParseError)

  const program = parseTokens(lexResult.tokens)
  if (program.kind !== 'complete') {
    errors.push(syntaxIssueToParseError(program.error, lexResult.end))
  }

  // A syntax error stops the parse; leftover input after the last statement
  // still yields the statements before it, so their semantic errors surface
  // in the same pass.
  if (program.kind === 'failed') return { ok: false, errors }
  const { diagram, errors: semanticErrors } = buildDiagram(program.statements)
  errors.push(...semanticErrors)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, diagram }
}

function lexErrorToParseError(e: LexError): ParseError {
  return {
    message: e.message,
    range: {
      start: { line: e.line, column: e.column, offset: e.offset },
      end: { line: e.line, column: e.column + e.length, offset: e.offset + e.length },
    },
  }
}

function syntaxIssueToParseError(e: SyntaxIssue, eof: SourcePos): ParseError {
  // An error with no token ran out of input: anchor it one character past the
  // end, so the editor can still underline it.
  const tok = e.token
  if (!tok) {
    return {
      message: e.message,
      range: {
        start: eof,
        end: { line: eof.line, column: eof.column + 1, offset: eof.offset + 1 },
      },
    }
  }
  return {
    message: e.message,
    range: {
      start: { line: tok.startLine, column: tok.startColumn, offset: tok.startOffset },
      end: { line: tok.endLine, column: tok.endColumn + 1, offset: tok.endOffset + 1 },
    },
  }
}
