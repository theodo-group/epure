// Chevrotain CST parser for the D2 subset.
//
// Grammar (informal):
//   program        := (statement Newline?)*
//   statement      := edgeDecl | nodeOrAreaDecl
//   nodeOrAreaDecl := Identifier (Colon labelOrValue)? (LCurly blockItem* RCurly)?
//   blockItem      := attr | memberStmt
//   attr           := Identifier (Dot Identifier)* Colon attrValue
//   memberStmt     := Identifier (Semicolon | Newline)?
//   edgeDecl       := Identifier arrowOp Identifier (Colon labelOrValue)? (LCurly attr* RCurly)?
//   arrowOp        := ArrowRight | ArrowLeft | ArrowBoth | DashDash
//   labelOrValue   := StringLit | Identifier
//   attrValue      := StringLit | Identifier | NumberLit
//
// The grammar is intentionally permissive about node-vs-area; the visitor
// disambiguates by inspecting the block items it collected.

import { CstParser, type IToken } from 'chevrotain'

import {
  allTokens,
  ArrowBoth,
  ArrowLeft,
  ArrowRight,
  Colon,
  DashDash,
  Dot,
  Identifier,
  LCurly,
  Newline,
  NumberLit,
  RCurly,
  Semicolon,
  StringLit,
} from './lexer'

export class D2Parser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: false,
      // We only need 2-token lookahead to distinguish edges (id arrow ...)
      // from node/area declarations (id colon ... | id { ... } | id alone).
      maxLookahead: 3,
    })
    this.performSelfAnalysis()
  }

  // program := (statement Newline?)*
  public program = this.RULE('program', () => {
    // Swallow leading blank lines.
    this.MANY1(() => this.CONSUME1(Newline))
    this.MANY2(() => {
      this.SUBRULE(this.statement)
      this.MANY3(() => this.CONSUME2(Newline))
    })
  })

  // statement := edgeDecl | nodeOrAreaDecl
  //
  // Disambiguated by looking at the token after the first Identifier: an
  // arrow operator means we're in an edge declaration.
  private statement = this.RULE('statement', () => {
    this.OR([
      {
        GATE: () => this.isArrowAhead(),
        ALT: () => this.SUBRULE(this.edgeDecl),
      },
      { ALT: () => this.SUBRULE(this.nodeOrAreaDecl) },
    ])
  })

  // nodeOrAreaDecl := Identifier (Colon labelOrValue)? (LCurly blockItem* RCurly)?
  private nodeOrAreaDecl = this.RULE('nodeOrAreaDecl', () => {
    this.CONSUME(Identifier)
    this.OPTION1(() => {
      this.CONSUME(Colon)
      this.SUBRULE(this.labelOrValue)
    })
    this.OPTION2(() => {
      this.CONSUME(LCurly)
      // Allow a newline immediately after `{`.
      this.MANY1(() => this.CONSUME1(Newline))
      this.MANY2(() => {
        this.SUBRULE(this.blockItem)
        // Block items are terminated by `;` or newline; both are optional
        // before `}` so a trailing item works.
        this.MANY3(() => {
          this.OR2([
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME2(Newline) },
          ])
        })
      })
      this.CONSUME(RCurly)
    })
  })

  // blockItem := attr | memberStmt
  //
  // We distinguish on the second token: `Identifier Colon` or `Identifier Dot`
  // is an attr; `Identifier` followed by anything else (`;`, newline, `}`) is
  // a member declaration.
  private blockItem = this.RULE('blockItem', () => {
    this.OR([
      {
        GATE: () => this.isAttrAhead(),
        ALT: () => this.SUBRULE(this.attr),
      },
      { ALT: () => this.SUBRULE(this.memberStmt) },
    ])
  })

  // attr := Identifier (Dot Identifier)* Colon attrValue
  private attr = this.RULE('attr', () => {
    this.CONSUME(Identifier)
    this.MANY(() => {
      this.CONSUME(Dot)
      this.CONSUME2(Identifier)
    })
    this.CONSUME(Colon)
    this.SUBRULE(this.attrValue)
  })

  // memberStmt := Identifier
  // Terminators (`;`, newline) are consumed by the enclosing block rule.
  private memberStmt = this.RULE('memberStmt', () => {
    this.CONSUME(Identifier)
  })

  // edgeDecl := Identifier arrowOp Identifier (Colon labelOrValue)? (LCurly attr* RCurly)?
  private edgeDecl = this.RULE('edgeDecl', () => {
    this.CONSUME(Identifier)
    this.SUBRULE(this.arrowOp)
    this.CONSUME2(Identifier)
    this.OPTION1(() => {
      this.CONSUME(Colon)
      this.SUBRULE(this.labelOrValue)
    })
    this.OPTION2(() => {
      this.CONSUME(LCurly)
      this.MANY1(() => this.CONSUME1(Newline))
      this.MANY2(() => {
        this.SUBRULE(this.attr)
        this.MANY3(() => {
          this.OR([
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME2(Newline) },
          ])
        })
      })
      this.CONSUME(RCurly)
    })
  })

  // arrowOp := -> | <- | <-> | --
  private arrowOp = this.RULE('arrowOp', () => {
    this.OR([
      { ALT: () => this.CONSUME(ArrowRight) },
      { ALT: () => this.CONSUME(ArrowLeft) },
      { ALT: () => this.CONSUME(ArrowBoth) },
      { ALT: () => this.CONSUME(DashDash) },
    ])
  })

  // labelOrValue := StringLit | Identifier+
  //
  // Unquoted labels may contain spaces (e.g. `api: Web App`), so we greedily
  // consume consecutive identifiers up to the next structural token.
  private labelOrValue = this.RULE('labelOrValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },
      {
        ALT: () => {
          this.CONSUME(Identifier)
          this.MANY(() => this.CONSUME2(Identifier))
        },
      },
    ])
  })

  // attrValue := StringLit | Identifier | NumberLit
  private attrValue = this.RULE('attrValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(NumberLit) },
    ])
  })

  // --- Lookahead helpers --------------------------------------------------

  private isArrowAhead(): boolean {
    const t1 = this.LA(1) as IToken
    const t2 = this.LA(2) as IToken
    if (t1.tokenType !== Identifier) return false
    return (
      t2.tokenType === ArrowRight ||
      t2.tokenType === ArrowLeft ||
      t2.tokenType === ArrowBoth ||
      t2.tokenType === DashDash
    )
  }

  private isAttrAhead(): boolean {
    const t1 = this.LA(1) as IToken
    const t2 = this.LA(2) as IToken
    if (t1.tokenType !== Identifier) return false
    return t2.tokenType === Colon || t2.tokenType === Dot
  }
}

// Single shared parser instance (Chevrotain best practice — building a parser
// is expensive, parsing isn't).
export const parserInstance = new D2Parser()
