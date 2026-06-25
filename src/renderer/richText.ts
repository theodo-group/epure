// A tiny HTML-subset renderer for node labels.
//
// Supported tags: <b>/<strong>, <i>/<em>, <small>, and <br>. A literal
// "\n" (already produced by the D2 lexer for "\\n" escapes) is also a hard
// break. Everything else is treated as literal text — we never inject HTML
// into the DOM, so there is no XSS surface: tags are parsed here and the
// label is then rendered as SVG <tspan> nodes carrying just the style flags.

export interface RichWord {
  text: string
  bold?: boolean
  italic?: boolean
  small?: boolean
}

export interface RichLine {
  words: RichWord[]
}

const TAG_RE = /^<\s*(\/?)(b|strong|i|em|small|br)\s*\/?\s*>/i

const tagKey = (raw: string): 'b' | 'i' | 'small' | 'br' => {
  const t = raw.toLowerCase()
  if (t === 'strong') return 'b'
  if (t === 'em') return 'i'
  return t as 'b' | 'i' | 'small' | 'br'
}

export const parseRichText = (label: string): RichLine[] => {
  const lines: RichLine[] = [{ words: [] }]
  let bold = 0
  let italic = 0
  let small = 0
  let word = ''

  const flushWord = () => {
    if (!word) return
    lines[lines.length - 1]!.words.push({
      text: word,
      ...(bold > 0 ? { bold: true } : {}),
      ...(italic > 0 ? { italic: true } : {}),
      ...(small > 0 ? { small: true } : {}),
    })
    word = ''
  }

  let i = 0
  while (i < label.length) {
    const ch = label[i]!
    // Explicit line breaks come from "\n" inside quoted strings (the lexer
    // already turned "\\n" into a real newline).
    if (ch === '\n') {
      flushWord()
      lines.push({ words: [] })
      i++
      continue
    }
    if (/\s/.test(ch)) {
      flushWord()
      i++
      continue
    }
    if (ch === '<') {
      const m = label.slice(i).match(TAG_RE)
      if (m) {
        flushWord()
        const closing = m[1] === '/'
        const key = tagKey(m[2]!)
        if (key === 'br') {
          lines.push({ words: [] })
        } else if (key === 'b') {
          bold = Math.max(0, bold + (closing ? -1 : 1))
        } else if (key === 'i') {
          italic = Math.max(0, italic + (closing ? -1 : 1))
        } else if (key === 'small') {
          small = Math.max(0, small + (closing ? -1 : 1))
        }
        i += m[0].length
        continue
      }
    }
    word += ch
    i++
  }
  flushWord()
  return lines
}

// True when at least one tag we recognise actually parsed out. Lets the
// renderer skip the rich path entirely for plain labels.
export const hasRichMarkup = (label: string): boolean =>
  /<\s*\/?\s*(b|strong|i|em|small|br)\s*\/?\s*>/i.test(label) ||
  label.includes('\n')

// Re-wrap rich lines so no rendered line exceeds `maxChars` characters. Hard
// breaks (real <br>/\n in the input) are preserved as line boundaries; we
// only word-wrap the runs in between.
export const wrapRichText = (
  lines: RichLine[],
  maxChars: number,
): RichLine[] => {
  const out: RichLine[] = []
  for (const line of lines) {
    if (line.words.length === 0) {
      out.push({ words: [] })
      continue
    }
    let cur: RichWord[] = []
    let curLen = 0
    for (const w of line.words) {
      const wLen = w.text.length
      const sep = curLen === 0 ? 0 : 1
      if (curLen === 0 || curLen + sep + wLen <= maxChars) {
        cur.push(w)
        curLen += sep + wLen
      } else {
        out.push({ words: cur })
        cur = [w]
        curLen = wLen
      }
    }
    out.push({ words: cur })
  }
  return out
}
