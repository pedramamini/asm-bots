import type { Cursor } from './cursor'
import type { Token } from './lexer'

/**
 * Tokens one line may expand to, macro names included: past it, a chain of `%define`s that
 * doubles at each step is an error, not a hang (the API assembles untrusted source).
 */
const MAX_TOKENS = 10_000

/**
 * `%define NAME text` (ISA §6.2): one-line text macros without parameters, applied to the tokens
 * of each line before it is parsed. The NASM rules: a definition applies from its line on, and a
 * later one replaces it; a use expands when it is read, so the text may name macros defined after
 * it; an expansion expands again, except for the macro being expanded (`%define x x+1` is sound).
 * Names are case-sensitive.
 */
export class Defines {
  private readonly macros = new Map<string, readonly Token[]>()

  /** Reads a `%define` line, directive first. */
  define(c: Cursor): void {
    c.next()
    const name = c.next()
    if (name.kind !== 'ident') {
      c.fail('bad-directive', '`%define` needs a name: `%define NAME text`', c.where(name))
    }
    const open = c.peek()
    if (open.kind === 'punct' && open.text === '(' && open.col === name.col + name.len) {
      c.fail('unsupported', 'macro parameters are not supported', open)
    }
    const text: Token[] = []
    while (!c.atEnd) text.push(c.next())
    this.macros.set(name.text, text)
  }

  /**
   * `tokens` (one line, terminator last) with every macro expanded. An expanded token takes the
   * place of the name it replaces, so a diagnostic points at the use. An expansion that is too
   * long fails through `c`, a cursor on the same line.
   */
  expand(tokens: readonly Token[], c: Cursor): readonly Token[] {
    if (this.macros.size === 0) return tokens
    const out: Token[] = []
    let budget = MAX_TOKENS
    for (const use of tokens) {
      if (this.text(use) === undefined) {
        out.push(use)
        continue
      }
      // Depth-first over the expansion of `use`, with a stack instead of recursion: each entry is
      // a macro being expanded and the index of its next token.
      const stack: { name: string; text: readonly Token[]; next: number }[] = []
      const active = new Set<string>()
      let t: Token | undefined = use
      while (t !== undefined) {
        if (--budget < 0) c.fail('bad-directive', 'macro expansion is too long', use)
        const text = this.text(t)
        if (text !== undefined && !active.has(t.text)) {
          stack.push({ name: t.text, text, next: 0 })
          active.add(t.text)
        } else {
          out.push({ ...t, line: use.line, col: use.col, len: use.len })
        }
        t = undefined
        for (let top = stack.at(-1); t === undefined && top !== undefined; top = stack.at(-1)) {
          t = top.text[top.next++]
          if (t === undefined) {
            stack.pop()
            active.delete(top.name)
          }
        }
      }
    }
    return out
  }

  private text(t: Token): readonly Token[] | undefined {
    return t.kind === 'ident' ? this.macros.get(t.text) : undefined
  }
}
