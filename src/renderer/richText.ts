// A tiny HTML-subset renderer for node labels.
//
// Supported tags: <b>/<strong>, <i>/<em>, <small>, <br>, and <ul>/<li>
// (bulleted lists). A literal "\n" (already produced by the D2 lexer for "\\n"
// escapes) is also a hard break. Everything else is treated as literal text —
// we never inject HTML into the DOM, so there is no XSS surface: tags are
// parsed here and the label is then rendered as SVG <tspan> nodes carrying just
// the style flags.

export interface RichWord {
  text: string
  bold?: boolean
  italic?: boolean
  small?: boolean
}

export interface RichLine {
  words: RichWord[]
  /** Rendered as a bulleted list item (a `<li>` inside `<ul>`). */
  bullet?: boolean
}

// Recognised label tags, anchored at the start of a slice. Shared with the
// label editor (`@/editor/labelMarkup`) so the render layer and the edit layer
// agree on exactly which markup is meaningful.
export const LABEL_TAG_RE = /^<\s*(\/?)(b|strong|i|em|small|br|ul|li)\s*\/?\s*>/i

export const tagKey = (raw: string): 'b' | 'i' | 'small' | 'br' | 'ul' | 'li' => {
  const t = raw.toLowerCase()
  if (t === 'strong') return 'b'
  if (t === 'em') return 'i'
  return t as 'b' | 'i' | 'small' | 'br' | 'ul' | 'li'
}

export const parseRichText = (label: string): RichLine[] => {
  const lines: RichLine[] = [{ words: [] }]
  let bold = 0
  let italic = 0
  let small = 0
  let word = ''
  // Set after a `</ul>`: the return to an ordinary line is deferred until real
  // content actually follows, so a list that ends the label leaves no trailing
  // blank line.
  let afterList = false

  const cur = () => lines[lines.length - 1]!

  const flushWord = () => {
    if (!word) return
    cur().words.push({
      text: word,
      ...(bold > 0 ? { bold: true } : {}),
      ...(italic > 0 ? { italic: true } : {}),
      ...(small > 0 ? { small: true } : {}),
    })
    word = ''
  }

  // Start a fresh line. When the current line is still empty (and not already a
  // bullet), reuse it instead of leaving a spurious blank line — this keeps a
  // leading "<ul><li>…" from emitting an empty first line.
  const startLine = (bullet: boolean) => {
    flushWord()
    const c = cur()
    if (c.words.length === 0 && !c.bullet) {
      if (bullet) c.bullet = true
      return
    }
    lines.push(bullet ? { words: [], bullet: true } : { words: [] })
  }

  let i = 0
  while (i < label.length) {
    const ch = label[i]!
    // Explicit line breaks come from "\n" inside quoted strings (the lexer
    // already turned "\\n" into a real newline).
    if (ch === '\n') {
      flushWord()
      afterList = false
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
      const m = label.slice(i).match(LABEL_TAG_RE)
      if (m) {
        const closing = m[1] === '/'
        const key = tagKey(m[2]!)
        if (key === 'br') {
          flushWord()
          afterList = false
          lines.push({ words: [] })
        } else if (key === 'b') {
          flushWord()
          bold = Math.max(0, bold + (closing ? -1 : 1))
        } else if (key === 'i') {
          flushWord()
          italic = Math.max(0, italic + (closing ? -1 : 1))
        } else if (key === 'small') {
          flushWord()
          small = Math.max(0, small + (closing ? -1 : 1))
        } else if (key === 'li') {
          // Opening <li> starts a bullet line; </li> just ends the run so the
          // next <li> (or trailing content) opens a fresh line.
          if (!closing) {
            afterList = false
            startLine(true)
          } else flushWord()
        } else if (key === 'ul') {
          // A closing </ul> defers the return to an ordinary line (see
          // `afterList`) so a trailing list adds no blank line.
          flushWord()
          if (closing) afterList = true
        }
        i += m[0].length
        continue
      }
    }
    // First real character after a list: drop back to an ordinary line now that
    // there is actually content to put on it.
    if (afterList) {
      startLine(false)
      afterList = false
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
  /<\s*\/?\s*(b|strong|i|em|small|br|ul|li)\s*\/?\s*>/i.test(label) ||
  label.includes('\n')

// Re-wrap rich lines so no rendered line exceeds `maxChars` characters. Hard
// breaks (real <br>/\n in the input) and list items are preserved as line
// boundaries; we only word-wrap the runs in between. A wrapped bullet line
// keeps its bullet on the first visual line only.
export const wrapRichText = (
  lines: RichLine[],
  maxChars: number,
): RichLine[] => {
  const out: RichLine[] = []
  for (const line of lines) {
    if (line.words.length === 0) {
      out.push(line.bullet ? { words: [], bullet: true } : { words: [] })
      continue
    }
    let cur: RichWord[] = []
    let curLen = 0
    let first = true
    const pushSeg = () => {
      out.push(
        first && line.bullet ? { words: cur, bullet: true } : { words: cur },
      )
      first = false
    }
    for (const w of line.words) {
      const wLen = w.text.length
      const sep = curLen === 0 ? 0 : 1
      if (curLen === 0 || curLen + sep + wLen <= maxChars) {
        cur.push(w)
        curLen += sep + wLen
      } else {
        pushSeg()
        cur = [w]
        curLen = wLen
      }
    }
    pushSeg()
  }
  return out
}
