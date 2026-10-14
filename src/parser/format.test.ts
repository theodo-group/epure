import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatD2, stripRanges } from './format'
import { parse } from './index'

const fmt = (source: string): string => {
  const result = formatD2(source)
  if (!result.ok) throw new Error(`does not parse: ${result.errors[0]?.message}`)
  return result.text
}

/** Formatter-independent view of the comments: every `#…` outside a string. */
const commentsOf = (source: string): string[] =>
  (source.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""').match(/#[^\n]*/g) ?? [])
    .map((c) => c.trimEnd())
    .sort()

const diagramOf = (source: string) => {
  const result = parse(source)
  if (!result.ok) throw new Error(`does not parse: ${result.errors[0]?.message}`)
  return stripRanges(result.diagram)
}

/** The three invariants: same diagram, idempotent, every comment kept. */
const expectInvariants = (source: string) => {
  const result = formatD2(source)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.order).not.toBe('unchanged')
  expect(diagramOf(result.text)).toEqual(diagramOf(source))
  expect(fmt(result.text)).toBe(result.text)
  expect(commentsOf(result.text)).toEqual(commentsOf(source))
}

describe('formatD2 — house style', () => {
  it('formats the golden example', () => {
    const input = [
      'user: "Patient" { shape: person }',
      'web: "<small><b>Front web</b></small>"',
      'legacy    : "<b>ERP</b>"',
      'user -> web',
      'web -> legacy',
      '',
    ].join('\n')
    expect(fmt(input)).toBe(
      [
        'user: "Patient" { shape: person }',
        'web: "<small><b>Front web</b></small>"',
        'legacy: "<b>ERP</b>"',
        '',
        'user -> web',
        'web -> legacy',
        '',
      ].join('\n'),
    )
    expectInvariants(input)
  })

  it('normalizes spacing around `:`, arrows, labels and attributes', () => {
    expect(fmt('a:Web    App\nb :  "B"{shape:cylinder}\na->b:"x"\nb<-a\na<->b\na--b\n')).toBe(
      'a: Web App\nb: "B" { shape: cylinder }\n\na -> b: "x"\nb <- a\na <-> b\na -- b\n',
    )
  })

  it('moves declarations before edges, keeping each group in order', () => {
    const input = 'a -> b\nb\nc -> a\na\nc\n'
    expect(fmt(input)).toBe('b\na\nc\n\na -> b\nc -> a\n')
    expectInvariants(input)
  })

  it('puts statements sharing a line on their own lines', () => {
    expect(fmt('a b -> c d\n')).toBe('a\nd\n\nb -> c\n')
  })

  it('keeps single blank lines, collapses runs, trims the edges of the file', () => {
    expect(fmt('\n\n  a  \n\n\n\nb\nc\n\n\n')).toBe('a\n\nb\nc\n')
  })

  it('ends with exactly one newline, and leaves an empty document empty', () => {
    expect(fmt('a')).toBe('a\n')
    expect(fmt('')).toBe('')
    expect(fmt('\n\n')).toBe('')
  })

  it('reads CRLF line breaks and writes LF', () => {
    expect(fmt('a\r\nb # note\r\na -> b\r\n')).toBe('a\nb # note\n\na -> b\n')
  })
})

describe('formatD2 — blocks', () => {
  it('keeps a one-line block inline, normalizing its separators', () => {
    expect(fmt('g {a;b;  c;}\nn {shape: person; style.fill: red}\ne {}\n')).toBe(
      'g { a; b; c }\nn { shape: person; style.fill: red }\ne {}\n',
    )
  })

  it('lays a multi-line block out one item per line, indented two spaces', () => {
    const input = 'g: "G" {   a; b\n\n\n      c\n\n}\nx -> y {\nstyle.stroke-dash: 3 }\n'
    expect(fmt(input)).toBe('g: "G" {\n  a\n  b\n\n  c\n}\n\nx -> y {\n  style.stroke-dash: 3\n}\n')
    expectInvariants(input)
  })
})

describe('formatD2 — comments', () => {
  it('keeps a trailing comment on its line, one space before it', () => {
    expect(fmt('a: "A"     # the a\na -> b  #why\n')).toBe('a: "A" # the a\n\na -> b #why\n')
  })

  it('moves a comment with the statement it precedes', () => {
    const input = 'a -> b\n# about c\n#   (two lines)\nc\n'
    expect(fmt(input)).toBe('# about c\n#   (two lines)\nc\n\na -> b\n')
    expectInvariants(input)
  })

  it('keeps the header at the top and the footer at the end', () => {
    const input = '# Title\n\n# edges first\na -> b\nb\n# the end\n'
    expect(fmt(input)).toBe('# Title\n\nb\n\n# edges first\na -> b\n# the end\n')
    expectInvariants(input)
  })

  it('keeps comments inside a block in place', () => {
    const input = [
      'g {  # open',
      '# first',
      '    a',
      '  b   # second',
      '   # before close',
      '}   # after close',
      '',
    ].join('\n')
    expect(fmt(input)).toBe(
      [
        'g { # open',
        '  # first',
        '  a',
        '  b # second',
        '  # before close',
        '} # after close',
        '',
      ].join('\n'),
    )
    expectInvariants(input)
  })

  it('leaves a `#` inside a string alone', () => {
    expect(fmt('a: "#1 in # town"\n')).toBe('a: "#1 in # town"\n')
  })
})

describe('formatD2 — refusals', () => {
  it('does not format a document that does not parse', () => {
    const result = formatD2('a -> \nb {')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('formatD2 — invariants over real diagrams', () => {
  const root = process.cwd()
  const files = ['fixtures', 'docs/diagrams'].flatMap((dir) =>
    readdirSync(resolve(root, dir))
      .filter((f) => f.endsWith('.epr.d2'))
      .map((f) => `${dir}/${f}`),
  )

  it.each(files)('%s formats to the same diagram, idempotently, comments kept', (file) => {
    expectInvariants(readFileSync(resolve(root, file), 'utf8'))
  })

  it('holds on hand-made edge cases', () => {
    const cases = [
      'a',
      '# only a comment',
      '# c1\n\n\n# c2\n',
      'a -> b # t\n# lead\n\nc { x; y }\n# tail\n\n# tail 2',
      'p: Some Label {\n  # c\n}\nq -> p: lbl { style.stroke-dash: 5 } # e\n',
      'outer {\n  inner\n}\ninner {\n  a\n  b\n}\na -> b\n',
      "s: 'single' { shape: rectangle }\n",
      'a -> b\n\n\n# floating\n\n\nc\n',
    ]
    for (const source of cases) expectInvariants(source)
  })
})
