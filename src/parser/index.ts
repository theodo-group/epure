// Public entrypoint: parse(source) -> ParseResult.

import type { ILexingError, IRecognitionException, IToken } from 'chevrotain'

import type { ParseError, ParseResult, SourceRange } from './ast'
import { lexer } from './lexer'
import { parserInstance } from './parser'
import { D2Visitor } from './visitor'

export * from './ast'

export function parse(source: string): ParseResult {
  const lexResult = lexer.tokenize(source)

  const errors: ParseError[] = lexResult.errors.map(lexErrorToParseError)

  parserInstance.input = lexResult.tokens
  const cst = parserInstance.program()

  for (const e of parserInstance.errors) {
    errors.push(parserErrorToParseError(e))
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

function parserErrorToParseError(e: IRecognitionException): ParseError {
  const tok: IToken | undefined = e.token
  const range: SourceRange = tok
    ? {
        start: {
          line: tok.startLine ?? 1,
          column: tok.startColumn ?? 1,
          offset: tok.startOffset,
        },
        end: {
          line: tok.endLine ?? tok.startLine ?? 1,
          column: (tok.endColumn ?? tok.startColumn ?? 1) + 1,
          offset: (tok.endOffset ?? tok.startOffset) + 1,
        },
      }
    : emptyRange()
  return { message: e.message, range }
}

function emptyRange(): SourceRange {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  }
}
