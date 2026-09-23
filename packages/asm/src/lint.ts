import { ALIASES } from '@asmbots/codec'
import { type Assembled, type AssembleOptions, maxBytesOf } from './assemble'
import type { DataLine, Expr, InstrLine, Line, OperandAst, Span } from './ast'
import type { Diag, DiagCode } from './diag'
import { type Token, tokenize } from './lexer'
import { parse } from './parser'

/**
 * Warnings about a bot that assembles but may not do what its author means (ARCHITECTURE §4).
 * `assembled` is `assemble(source, opts)`, with the same `opts`: the size check reads its bytes,
 * and its listing tells whether a `times`, `resb`, or `align` line emits any. Each warning has a
 * `fix`, and they come in source order.
 *
 * - `absolute-address`: a memory operand with no register, `[label]` or `[0x0100]`, which is a
 *   fixed place in the core, not in the bot (ISA §6.4).
 * - `unreachable`: code after a `jmp`, `ret`, `hlt`, `int3`, or DAT, with no label between, once
 *   per run of such code.
 * - `dat-in-code`: DAT that code falls into: `dat`, or the zeros of `resb`, `resw`, and `align`.
 * - `hlt-in-code`: a `hlt` the bot runs: the first instruction, one that code falls into, or one
 *   under a label that a jump, call, loop, or `spl` names.
 * - `uninitialized-di`: a string instruction that uses di (`movs`, `cmps`, `stos`, `scas`) before
 *   any line in the source sets di. Heuristic: source order, not execution order.
 * - `size-near-cap`: a bot of 90% of the size limit or more, at the line where it gets there.
 * - `no-strategy`: no `%strategy`, or an empty one.
 *
 * @throws RangeError when `opts.maxBytes` is not an integer in 0..65536.
 */
export function lint(source: string, assembled: Assembled, opts: AssembleOptions = {}): Diag[] {
  const maxBytes = maxBytesOf(opts)
  const tokens = tokenize(source)
  const { lines } = parse(tokens)
  const texts = source.split(/\r\n|\r|\n/)
  const warnings = [
    ...absoluteAddresses(lines, texts),
    ...flow(lines, assembled),
    ...uninitializedDi(lines),
    ...sizeNearCap(lines, assembled, maxBytes),
    ...noStrategy(lines, tokens),
  ]
  return warnings.sort((a, b) => a.line - b.line || a.col - b.col)
}

function warning(line: number, at: Span, code: DiagCode, message: string, fix: string): Diag {
  return { severity: 'warning', line, col: at.col, len: at.len, message, code, fix }
}

/** The mnemonic as the codec names it: `je` is `jz`. */
const canonical = (mnemonic: string) => ALIASES.get(mnemonic) ?? mnemonic

/** What a line runs or holds: the line itself, or what `times` repeats. */
function statement(line: Line): InstrLine | DataLine | undefined {
  if (line.kind === 'times') return line.body
  return line.kind === 'instr' || line.kind === 'data' ? line : undefined
}

const BASE_IDIOM = '`call .here` / `.here: pop bx` / `sub bx, .here`'

function absoluteAddresses(lines: readonly Line[], texts: readonly string[]): Diag[] {
  const out: Diag[] = []
  for (const line of lines) {
    const s = statement(line)
    if (s?.kind !== 'instr') continue
    for (const op of s.operands) {
      if (op.kind !== 'mem' || op.base !== undefined || op.index !== undefined) continue
      const text = (texts[line.line - 1] ?? '').slice(op.col - 1, op.col - 1 + op.len)
      // The address as written, without a displacement size: `bomb` in `word [word bomb]`.
      const inner = /\[\s*(?:(?:byte|word)\s+)?([^\]]*?)\s*\]/i.exec(text)?.[1] || 'label'
      const based = `[bx${inner.startsWith('-') ? '' : '+'}${inner}]`
      out.push(
        warning(
          line.line,
          op,
          'absolute-address',
          `\`${text}\` is an absolute address: a fixed place in the core, not in this bot, which the loader places anywhere (ISA §6.4)`,
          `for the bot's own data, add a base register: \`${based}\`, with bx from the base idiom ${BASE_IDIOM}`,
        ),
      )
    }
  }
  return out
}

/**
 * How execution leaves a line: `code` falls through to the next line, `stop` never does (`jmp`,
 * `ret`, `hlt`, `int3`), `dat` kills the process that runs it, and `data` is `db` or `dw`, which
 * may hold code or not. Undefined for a line that emits nothing.
 */
type Flow = 'code' | 'stop' | 'dat' | 'data'

const STOPS: ReadonlySet<string> = new Set(['jmp', 'ret', 'hlt', 'int3'])

function flowOf(line: Line): Flow | undefined {
  const s = statement(line)
  if (s?.kind === 'data') return s.mnemonic === 'db' || s.mnemonic === 'dw' ? 'data' : 'dat'
  if (s?.kind === 'instr') {
    const m = canonical(s.mnemonic)
    return m === 'dat' ? 'dat' : STOPS.has(m) ? 'stop' : 'code'
  }
  return line.kind === 'directive' && line.mnemonic === 'align' ? 'dat' : undefined
}

/** The word to name a line by in a message: `jmp`, `resb`, or `times`'s repeated word. */
function wordOf(line: Line): string {
  const s = statement(line)
  return s === undefined ? (line.kind === 'empty' ? '' : line.mnemonic) : s.mnemonic
}

/** The symbols `e` names. */
function symbols(e: Expr, out: Set<string>): Set<string> {
  if (e.kind === 'sym') out.add(e.name)
  else if (e.kind === 'unary') symbols(e.arg, out)
  else if (e.kind === 'binary') {
    symbols(e.left, out)
    symbols(e.right, out)
  }
  return out
}

/** `unreachable`, `dat-in-code`, and `hlt-in-code`: one walk over the lines in order. */
function flow(lines: readonly Line[], assembled: Assembled): Diag[] {
  const out: Diag[] = []
  // A line's bytes, when the bot assembled; `times 0 nop`, `resb 0`, and an `align` that is
  // already aligned emit none. Without them, an `align` is taken to emit none.
  const listed = assembled.listing.length === lines.length
  const emits = (line: Line) =>
    listed ? (assembled.listing[line.line - 1]?.bytes.length ?? 0) > 0 : line.kind !== 'directive'
  const targets = new Set<string>()
  for (const line of lines) {
    const s = statement(line)
    if (s?.kind !== 'instr') continue
    for (const op of s.operands) if (op.kind === 'target') symbols(op.expr, targets)
  }
  /** How execution leaves the last line that emits, and whether anything reaches that line. */
  let prev: { flow: Flow; live: boolean } | undefined
  /** The `stop` or DAT line with no label after it: nothing falls through or jumps to here. */
  let dead: Line | undefined
  let reported = false
  /** The labels of the lines since the last line that emits: they all name the next one. */
  let labels: string[] = []
  for (const line of lines) {
    if (line.label !== undefined && line.kind !== 'equ') {
      labels.push(line.label.name)
      dead = undefined
    }
    const f = flowOf(line)
    if (f === undefined || !emits(line)) continue
    const fallsIn = prev?.flow === 'code' && prev.live
    if (dead !== undefined && !reported && (f === 'code' || f === 'stop')) {
      reported = true
      out.push(
        warning(
          line.line,
          line,
          'unreachable',
          `unreachable code: the \`${wordOf(dead)}\` on line ${dead.line} never falls through, and no label lets a jump in here`,
          'add a label if a jump should reach this code, or delete the code up to the next label',
        ),
      )
    }
    if (f === 'dat' && fallsIn) out.push(datInCode(line))
    const s = statement(line)
    if (s?.kind === 'instr' && canonical(s.mnemonic) === 'hlt') {
      const first = prev === undefined
      if (first || fallsIn || labels.some((l) => targets.has(l))) {
        out.push(
          warning(
            line.line,
            line,
            'hlt-in-code',
            first
              ? '`hlt` is the first instruction: the bot halts itself at once'
              : '`hlt` kills the process that runs it, and the bot runs this one: it halts itself',
            'to park a process, spin with `jmp $`; keep a bomb template after a `jmp`, where no code runs into it',
          ),
        )
      }
    }
    prev = { flow: f, live: dead === undefined }
    if ((f === 'stop' || f === 'dat') && dead === undefined) {
      dead = line
      reported = false
    }
    labels = []
  }
  return out
}

function datInCode(line: Line): Diag {
  const word = wordOf(line)
  const what =
    word === 'align'
      ? 'the padding of `align`, which is DAT (00), not NOP as in NASM'
      : word === 'dat'
        ? '`dat`'
        : `\`${word}\`, whose zero bytes are DAT`
  return warning(
    line.line,
    line,
    'dat-in-code',
    `the line before falls through into ${what}: the process dies there`,
    'end the code before it with a `jmp`, or move the data after the code',
  )
}

/** String instructions that read or write at di. */
const DI_STRING: ReadonlySet<string> = new Set([
  'movsb',
  'movsw',
  'cmpsb',
  'cmpsw',
  'stosb',
  'stosw',
  'scasb',
  'scasw',
])

/** Instructions that write their first operand. `xchg` writes both. */
const WRITES_FIRST: ReadonlySet<string> = new Set([
  ...['mov', 'lea', 'pop', 'add', 'adc', 'sub', 'sbb', 'and', 'or', 'xor'],
  ...['inc', 'dec', 'neg', 'not', 'shl', 'shr', 'sar', 'rol', 'ror', 'rcl', 'rcr'],
])

const isDi = (op: OperandAst | undefined) => op?.kind === 'reg' && op.name === 'di'

function uninitializedDi(lines: readonly Line[]): Diag[] {
  const out: Diag[] = []
  for (const line of lines) {
    const s = statement(line)
    if (s?.kind !== 'instr') continue
    const m = canonical(s.mnemonic)
    if (DI_STRING.has(m)) {
      out.push(
        warning(
          line.line,
          line,
          'uninitialized-di',
          `\`${s.mnemonic}\` uses di, and no line before it sets di: di starts at 0, a fixed place in the core`,
          'set di first, from the base register: `lea di, [bx+target]`',
        ),
      )
    }
    const [first] = s.operands
    if ((WRITES_FIRST.has(m) && isDi(first)) || (m === 'xchg' && s.operands.some(isDi))) break
  }
  return out
}

function sizeNearCap(lines: readonly Line[], assembled: Assembled, maxBytes: number): Diag[] {
  const size = assembled.bytes.length
  // A bot with errors has no bytes, and a bot over the limit is not near it.
  if (size === 0 || size > maxBytes || size * 10 < maxBytes * 9) return []
  const cross = assembled.listing.find((l) => (l.address + l.bytes.length) * 10 >= maxBytes * 9)
  const line = cross === undefined ? undefined : lines[cross.lineNo - 1]
  const percent = Math.floor((size * 100) / maxBytes)
  return [
    warning(
      line?.line ?? 1,
      line ?? { col: 1, len: 0 },
      'size-near-cap',
      `the bot is ${size} bytes, ${percent}% of the limit of ${maxBytes} (${maxBytes - size} left); it reaches 90% on this line`,
      'keep room for changes: rel8 jumps, `inc` and `dec` for small steps, fewer `times` repeats, less data',
    ),
  ]
}

function noStrategy(lines: readonly Line[], tokens: readonly Token[]): Diag[] {
  const fix =
    'say in one line how the bot fights: `%strategy "..."`; the arena and the hills show it'
  const given = lines.find((l) => l.kind === 'directive' && l.mnemonic === '%strategy')
  if (given !== undefined) {
    const text = given.operands[0]
    if (text?.kind !== 'str' || text.value.trim() !== '') return []
    return [warning(given.line, text, 'no-strategy', '`%strategy` is empty', fix)]
  }
  // A `%strategy` line the parser rejected has its own error.
  if (tokens.some((t) => t.kind === 'directive' && t.text.toLowerCase() === '%strategy')) return []
  const name = lines.find((l) => l.kind === 'directive' && l.mnemonic === '%name')
  return [
    warning(name?.line ?? 1, name ?? { col: 1, len: 0 }, 'no-strategy', 'no `%strategy`', fix),
  ]
}
