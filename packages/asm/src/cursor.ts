import type { Span } from './ast'
import type { Diag, DiagCode } from './diag'
import type { Token } from './lexer'

/** The first error on a line. The parser records it and goes on with the next line. */
export class ParseError {
  readonly diag: Diag

  constructor(diag: Diag) {
    this.diag = diag
  }
}

/** The span from the start of `a` to the end of `b`. */
export function join(a: Span, b: Span): Span {
  return { col: a.col, len: b.col + b.len - a.col }
}

const isEnd = (t: Token) => t.kind === 'newline' || t.kind === 'eof'

/** A token as a message names it: `` `mov` ``, or `end of line`. */
export function describe(t: Token): string {
  return isEnd(t) ? 'end of line' : `\`${t.text}\``
}

/**
 * Reads the tokens of one line. The last token is the line's `newline` or `eof`: once there,
 * `next` keeps returning it.
 */
export class Cursor {
  /** The global label that `.local` names belong to; `''` before the first one. */
  scope: string
  /** The last token read before the end of the line, where the statement ends. */
  last: Token
  private pos = 0

  constructor(
    private readonly tokens: readonly Token[],
    readonly line: number,
    scope: string,
  ) {
    this.scope = scope
    this.last = tokens[0] as Token
  }

  peek(ahead = 0): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)] as Token
  }

  next(): Token {
    const t = this.peek()
    if (!isEnd(t)) {
      this.pos++
      this.last = t
    }
    return t
  }

  /** Where the cursor is, for `rewind`. */
  mark(): number {
    return this.pos
  }

  /** Goes back to a `mark`, to read the tokens after it another way. */
  rewind(mark: number): void {
    this.pos = mark
    this.last = this.tokens[Math.max(mark - 1, 0)] as Token
  }

  get atEnd(): boolean {
    return isEnd(this.peek())
  }

  /** Where `t` is. The end of the line is the empty span after its last token. */
  where(t: Token): Span {
    if (!isEnd(t)) return t
    const before = this.tokens.at(-2)
    return before === undefined ? { col: t.col, len: 0 } : { col: before.col + before.len, len: 0 }
  }

  /**
   * The full name of the label or symbol `t` (ISA §6.1): a leading `$` escapes a reserved word
   * (`$ax` is the symbol `ax`), and a `.local` name gets the current global label in front.
   */
  name(t: Token): string {
    let name = t.text
    if (name.startsWith('$')) {
      name = name.slice(1)
      if (/^[0-9]/.test(name)) {
        this.fail('bad-number', "NASM's `$` hex prefix is not supported: write 0x1F or 1Fh", t)
      }
    }
    return name.startsWith('.') && !name.startsWith('..') ? this.scope + name : name
  }

  fail(code: DiagCode, message: string, at: Span): never {
    const { line } = this
    throw new ParseError({ severity: 'error', line, col: at.col, len: at.len, message, code })
  }

  /** Fails with ``expected `what`, found `t` ``. */
  unexpected(t: Token, what: string): never {
    return this.fail('syntax', `expected ${what}, found ${describe(t)}`, this.where(t))
  }
}
