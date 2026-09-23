import {
  EncodeError,
  encode,
  type InstrInput,
  type OperandInput,
  Reg8,
  Reg16,
} from '@asmbots/codec'
import type {
  DataLine,
  DirectiveLine,
  EquLine,
  Expr,
  ImmAst,
  InstrLine,
  Line,
  OperandAst,
  Size,
  Span,
  StrAst,
  SymExpr,
  TimesLine,
} from './ast'
import type { Diag, DiagCode } from './diag'
import { evaluate, evaluateExact, type Unresolved } from './expr'
import { bytesHex } from './hex'
import { BYTE_REGISTERS } from './keywords'
import { type Token, tokenize } from './lexer'
import { parse } from './parser'

/** ISA §5.5 `maxBotBytes`: the size limit when the caller sets none. */
export const MAX_BOT_BYTES = 512

/** Layout passes before the assembler gives up on sizes that keep changing (ARCHITECTURE §4). */
const MAX_PASSES = 16

/** The core is 64 KB. No bot is bigger, so a pass stops once it gets past it. */
const CORE_SIZE = 0x10000

/** The largest `times`, `resb`, or `resw` count. */
const MAX_COUNT = 0xffff

export interface AssembleOptions {
  /** The size limit in bytes, ISA §5.5 `maxBotBytes`: 0..65536, 512 when not given. */
  maxBytes?: number
}

/** One source line of the listing (ISA §6.5), for the debugger and the editor gutter. */
export interface ListingLine {
  /** 1-based. */
  lineNo: number
  /** The address of the line's first byte; for a line with no bytes, of the next byte. */
  address: number
  /** The line's bytes, a view into `Assembled.bytes`. */
  bytes: Uint8Array
  /** `bytes` as uppercase hex pairs: `C7 07 00 00`. */
  bytesHex: string
  /** The text of the line, without its line break. */
  source: string
}

/**
 * An assembled bot (ISA §6.5). A bot with an error has no `bytes`, `listing`, or `sourceMap`;
 * its metadata and `symbols` are what the assembler found.
 */
export interface Assembled {
  /** The `%name` text; empty when there is none, which is an error. */
  name: string
  /** The `%author`, `%strategy`, and `%version` texts; empty when not given. */
  author: string
  strategy: string
  version: string
  /** The bot image, at most `maxBytes` long. */
  bytes: Uint8Array
  /** Where the bot starts: always 0 in x16c v1. */
  entry: 0
  /** Label addresses and `equ` values, in source order; a `.local` label by its full name. */
  symbols: Map<string, number>
  /** One entry per source line. */
  listing: ListingLine[]
  /** The 1-based source line of each byte of `bytes`. */
  sourceMap: Uint16Array
  /** Every error, in source order. */
  diagnostics: Diag[]
}

/**
 * Assembles x16c source (ISA §6). Errors are collected, not thrown: lexer, parser, and assembler
 * diagnostics come back together in `diagnostics`.
 *
 * Layout runs in passes over the lines. Each pass gives every label the address it reaches and
 * every `equ` the value it has with the labels of the pass before, then sizes each instruction by
 * asking the codec to encode it. A forward reference reads the value from the pass before; on the
 * first pass it has none, and its operand gets a stand-in (a 16-bit field for an immediate or a
 * displacement, rel8 for a jump). An `auto` jump starts at rel8 and moves up to rel16 when rel8
 * does not reach, and never moves back, so the passes settle. They stop when a pass changes no
 * size; after 16 passes the result is the `no-convergence` error. A last pass emits the bytes
 * with the settled addresses.
 *
 * @throws RangeError when `maxBytes` is not an integer in 0..65536.
 */
export function assemble(source: string, opts: AssembleOptions = {}): Assembled {
  const maxBytes = maxBytesOf(opts)
  const diags: Diag[] = []
  const tokens = tokenize(source, diags)
  const { lines, diags: parseDiags } = parse(tokens)
  diags.push(...parseDiags)
  const meta = metadata(lines, diags)
  // A `%name` line the parser rejected has its own error already.
  if (!meta.named && !tokens.some(isNameDirective)) {
    const message = 'a bot needs a name: add a `%name "..."` line'
    diags.push({ severity: 'error', line: 1, col: 1, len: 0, message, code: 'missing-name' })
  }
  const layout = new Layout(lines, maxBytes, diags)
  const sink = layout.run()
  if (sink !== undefined) diags.push(...sink.diags)
  const { overLimit } = layout
  if (overLimit !== undefined) {
    // Past the core, the layout stopped and the size is not known.
    const size = layout.overflow === undefined ? layout.end : undefined
    const total = size === undefined ? `more than ${CORE_SIZE} bytes` : `${size} bytes`
    const over = size === undefined ? 'over' : `${size - maxBytes} over`
    const message = `the bot is ${total}, ${over} the limit of ${maxBytes}`
    diags.push(error(overLimit.line.line, overLimit.line, 'size-over-cap', message))
  }
  diags.sort((a, b) => a.line - b.line || a.col - b.col)
  const failed = diags.some((d) => d.severity === 'error')
  const image = failed ? undefined : sink?.result()
  if (image !== undefined && image.length !== layout.end) {
    throw new Error(`internal error: ${image.length} bytes emitted for a ${layout.end}-byte layout`)
  }
  return {
    name: meta.name,
    author: meta.author,
    strategy: meta.strategy,
    version: meta.version,
    bytes: image ?? new Uint8Array(0),
    entry: 0,
    symbols: layout.symbols(),
    listing: image === undefined ? [] : listing(layout.items, image, source),
    sourceMap: image === undefined ? new Uint16Array(0) : sourceMap(layout.items, image.length),
    diagnostics: diags,
  }
}

/**
 * The size limit of `opts`, 512 when not given.
 *
 * @throws RangeError when it is not an integer in 0..65536.
 */
export function maxBytesOf(opts: AssembleOptions): number {
  const maxBytes = opts.maxBytes ?? MAX_BOT_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > CORE_SIZE) {
    throw new RangeError(`maxBytes must be an integer in 0..${CORE_SIZE}, not ${maxBytes}`)
  }
  return maxBytes
}

function error(line: number, at: Span, code: DiagCode, message: string): Diag {
  return { severity: 'error', line, col: at.col, len: at.len, message, code }
}

const isNameDirective = (t: Token) => t.kind === 'directive' && t.text.toLowerCase() === '%name'

type Meta = Pick<Assembled, 'name' | 'author' | 'strategy' | 'version'>

const META_FIELDS: ReadonlyMap<string, keyof Meta> = new Map<string, keyof Meta>([
  ['%name', 'name'],
  ['%author', 'author'],
  ['%strategy', 'strategy'],
  ['%version', 'version'],
])

/** The metadata directives (ISA §6.2): each at most once, and `%name` not empty. */
function metadata(lines: readonly Line[], diags: Diag[]): Meta & { named: boolean } {
  const meta: Meta = { name: '', author: '', strategy: '', version: '' }
  const given = new Map<string, number>()
  for (const line of lines) {
    if (line.kind !== 'directive') continue
    const field = META_FIELDS.get(line.mnemonic)
    if (field === undefined) continue
    const first = given.get(line.mnemonic)
    if (first !== undefined) {
      const message = `\`${line.mnemonic}\` is already given on line ${first}`
      diags.push(error(line.line, line, 'bad-directive', message))
      continue
    }
    given.set(line.mnemonic, line.line)
    const text = line.operands[0]
    meta[field] = text?.kind === 'str' ? text.value : ''
    if (field === 'name' && meta.name.trim() === '') {
      diags.push(error(line.line, text ?? line, 'bad-directive', '`%name` cannot be empty'))
    }
  }
  return { ...meta, named: given.has('%name') }
}

/** A line, and what the passes learn about it. */
interface Item {
  readonly line: Line
  /** The label or `equ` name the line defines, unless an earlier line defines it. */
  readonly defines: string | undefined
  /** The address of the line in the latest pass. */
  address: number
  /** The bytes the line took in the latest pass; -1 before the first. */
  size: number
  /** The repeats (0 outside `times`) whose `auto` target has moved up to rel16, for good. */
  readonly near: Set<number>
}

/** The pass that emits: bytes, in a buffer that grows, and diagnostics. */
class Sink {
  readonly diags: Diag[] = []
  length = 0
  private buf = new Uint8Array(512)

  private reserve(n: number) {
    if (this.length + n <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n))
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
  }

  push(bytes: ArrayLike<number>) {
    this.reserve(bytes.length)
    this.buf.set(bytes, this.length)
    this.length += bytes.length
  }

  zeros(n: number) {
    this.reserve(n)
    this.buf.fill(0, this.length, this.length + n)
    this.length += n
  }

  /** Appends `count - 1` more copies of the last `size` bytes. */
  repeat(size: number, count: number) {
    const start = this.length - size
    for (let i = 1; i < count; i++) this.push(this.buf.subarray(start, start + size))
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

/** An instruction where a pass puts it, with the value of each operand (undefined: none yet). */
interface Placed {
  readonly line: InstrLine
  readonly values: readonly (number | undefined)[]
  /** The address of the instruction, where a relative target counts from. */
  readonly at: number
}

/** The lines and the passes over them. */
class Layout {
  readonly items: Item[]
  /** Label addresses and `equ` values, as the passes know them. */
  readonly values = new Map<string, number>()
  /** The first line whose end passed the size limit in the latest pass. */
  overLimit: Item | undefined
  /** The line that took the latest pass past the core; nothing after it was laid out. */
  overflow: Item | undefined
  /** The size of the bot in the latest pass. */
  end = 0
  /** The first definition of each `equ`. */
  private readonly equs = new Map<string, EquLine>()
  /** The `equ`s, each after the ones it uses; one on a cycle, or using one, is not there. */
  private readonly order: readonly EquLine[]
  private cycles: Map<string, Cycle> | undefined
  private readonly strings = new Map<StrAst, Uint8Array>()

  constructor(
    lines: readonly Line[],
    private readonly maxBytes: number,
    diags: Diag[],
  ) {
    const first = new Map<string, number>()
    this.items = lines.map((line) => {
      const { label } = line
      let defines: string | undefined
      if (label !== undefined) {
        const earlier = first.get(label.name)
        if (earlier === undefined) {
          first.set(label.name, line.line)
          defines = label.name
          if (line.kind === 'equ') this.equs.set(label.name, line)
        } else {
          const message = `\`${label.name}\` is already defined on line ${earlier}`
          diags.push(error(line.line, label, 'duplicate-symbol', message))
        }
      }
      return { line, defines, address: 0, size: -1, near: new Set<number>() }
    })
    this.order = equOrder(this.equs)
  }

  /**
   * Passes until no size changes, then one more that emits. Without a sink when a pass got past
   * the core: the bot is too big, and nothing else is worth reporting.
   */
  run(): Sink | undefined {
    let changed: Item | undefined
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      changed = this.pass()
      if (this.overflow !== undefined) return undefined
      if (changed === undefined) break
    }
    const sink = new Sink()
    if (changed !== undefined) sink.diags.push(noConvergence(changed))
    // With the sizes settled this pass changes none; if it does, the layout had not settled.
    const again = this.pass(sink)
    if (this.overflow !== undefined) return undefined
    if (again !== undefined && changed === undefined) sink.diags.push(noConvergence(again))
    return sink
  }

  /**
   * One pass from address 0. Returns the first line whose size changed. With a sink, the pass
   * emits the bytes and reports errors.
   */
  private pass(sink?: Sink): Item | undefined {
    this.computeEqus()
    this.overLimit = undefined
    let changed: Item | undefined
    let here = 0
    for (const item of this.items) {
      item.address = here
      if (item.defines !== undefined && item.line.kind !== 'equ') {
        this.values.set(item.defines, here & 0xffff)
      }
      const size = this.size(item, here, sink)
      if (size !== item.size) {
        changed ??= item
        item.size = size
      }
      here += size
      if (here > this.maxBytes) this.overLimit ??= item
      if (here > CORE_SIZE) {
        this.overflow = item
        return changed
      }
    }
    this.end = here
    return changed
  }

  /** Each `equ` from the labels of the pass before; its `$` is where its line was then. */
  private computeEqus() {
    for (const line of this.order) {
      const expr = equExpr(line)
      const here = this.items[line.line - 1]?.address ?? 0
      const v = expr === undefined ? undefined : evaluateExact(expr, this.values, here)
      if (typeof v === 'number') this.values.set(line.label.name, v)
      else this.values.delete(line.label.name)
    }
  }

  /** The bytes `item` takes at `here`; with a sink, it emits them or reports why it cannot. */
  private size(item: Item, here: number, sink?: Sink): number {
    const { line } = item
    switch (line.kind) {
      case 'empty':
        return 0
      case 'equ':
        if (sink !== undefined) this.checkEqu(line, sink)
        return 0
      case 'directive':
        return line.mnemonic === 'align' ? this.align(line, here, sink) : 0
      case 'data':
        return this.data(line, here, sink)
      case 'instr':
        return this.instr(item, line, 0, here, here, sink)
      case 'times':
        return this.times(item, line, here, sink)
    }
  }

  /**
   * One instruction at `at`, with `$` = `dollar`, which inside `times` is the address of the
   * `times` line for every repeat, as in NASM. Until the layout settles its size is a guess: a
   * value not known yet gets a stand-in, and so does a value the encoder refuses.
   */
  private instr(
    item: Item,
    line: InstrLine,
    rep: number,
    dollar: number,
    at: number,
    sink?: Sink,
  ): number {
    const values: (number | undefined)[] = []
    let missing: Unresolved | undefined
    for (const op of line.operands) {
      const expr = operandExpr(op)
      const v = expr === undefined ? undefined : evaluate(expr, this.values, dollar)
      if (typeof v === 'object') missing ??= v
      values.push(typeof v === 'number' ? v : undefined)
    }
    const exact = this.encodeLine(item, rep, { line, values, at }, false)
    let size = exact instanceof EncodeError ? 0 : exact.length
    if (exact instanceof EncodeError) {
      const guess = this.encodeLine(item, rep, { line, values, at }, true)
      if (!(guess instanceof EncodeError)) size = guess.length
    }
    if (sink === undefined) return size
    if (missing !== undefined) this.unresolved(missing, line.line, sink)
    else if (exact instanceof EncodeError) sink.diags.push(encodeError(exact, line))
    else sink.push(exact)
    return size
  }

  /**
   * Encodes with the `auto` target of repeat `rep` at the size it has reached: rel8 until rel8
   * fails and rel16 does not, then rel16 for good.
   */
  private encodeLine(
    item: Item,
    rep: number,
    v: Placed,
    standIn: boolean,
  ): Uint8Array | EncodeError {
    const near = item.near.has(rep)
    const first = encode(instrInput(v, near ? 16 : 8, standIn))
    const auto = v.line.operands.some((op) => op.kind === 'target' && op.hint === 'auto')
    if (near || !auto || !(first instanceof EncodeError)) return first
    const wide = encode(instrInput(v, 16, standIn))
    if (wide instanceof EncodeError) return first
    item.near.add(rep)
    return wide
  }

  /** `db`, `dw`, `resb`, or `resw`, with `$` = `dollar`. Only a count moves the size. */
  private data(line: DataLine, dollar: number, sink?: Sink): number {
    const { mnemonic } = line
    if (mnemonic === 'resb' || mnemonic === 'resw') {
      const size = this.count(line, dollar, sink) * (mnemonic === 'resw' ? 2 : 1)
      sink?.zeros(size)
      return size
    }
    const width = mnemonic === 'db' ? 1 : 2
    let size = 0
    for (const op of line.operands) {
      if (op.kind === 'str') {
        const bytes = this.utf8(op)
        size += bytes.length
        sink?.push(bytes)
        continue
      }
      size += width
      if (sink === undefined || op.kind !== 'imm') continue
      const v = evaluate(op.expr, this.values, dollar)
      if (typeof v !== 'number') this.unresolved(v, line.line, sink)
      else if (width === 2) sink.push([v & 0xff, v >> 8])
      else {
        // A byte takes -256..255, as an 8-bit immediate does (codec `encode`).
        const signed = v >= 0x8000 ? v - 0x10000 : v
        if (signed >= -256 && signed <= 255) sink.push([v & 0xff])
        else {
          const message = `\`db\` value ${signed} does not fit in a byte`
          sink.diags.push(error(line.line, op, 'out-of-range', message))
        }
      }
    }
    return size
  }

  /** NASM encodes a `db` string as UTF-8. */
  private utf8(op: StrAst): Uint8Array {
    let bytes = this.strings.get(op)
    if (bytes === undefined) {
      bytes = UTF8.encode(op.value)
      this.strings.set(op, bytes)
    }
    return bytes
  }

  /**
   * `times n body` (ISA §6.2). `$` is the address of the line in every repeat, as in NASM, so the
   * repeats are alike unless the body has a relative target: that counts from each repeat's own
   * address, and such a body is laid out repeat by repeat. A body reports its first error once.
   */
  private times(item: Item, line: TimesLine, here: number, sink?: Sink): number {
    const n = this.count(line, here, sink)
    const { body } = line
    if (n === 0) {
      // As NASM does, report undefined symbols in a body that is not there, but nothing else.
      if (sink !== undefined) this.checkSymbols(body, here, sink)
      return 0
    }
    if (body.kind === 'instr' && body.operands.some((op) => op.kind === 'target')) {
      let at = here
      let out = sink
      for (let rep = 0; rep < n && at <= CORE_SIZE; rep++) {
        const errors = out?.diags.length
        const size = this.instr(item, body, rep, here, at, out)
        at += size
        if (out?.diags.length !== errors) out = undefined
        // An instruction the encoder cannot size at all has an error; the rest would repeat it.
        if (size === 0) break
      }
      return at - here
    }
    const errors = sink?.diags.length
    const size =
      body.kind === 'data'
        ? this.data(body, here, sink)
        : this.instr(item, body, 0, here, here, sink)
    const fits = here + size * n <= CORE_SIZE
    if (sink !== undefined && sink.diags.length === errors && size > 0 && fits) sink.repeat(size, n)
    return size * n
  }

  /** Reports the undefined symbols in the values of `line`. */
  private checkSymbols(line: InstrLine | DataLine, dollar: number, sink: Sink) {
    for (const op of line.operands) {
      const expr = operandExpr(op)
      const v = expr === undefined ? undefined : evaluate(expr, this.values, dollar)
      if (typeof v === 'object' && v.code === 'undefined-symbol') {
        this.unresolved(v, line.line, sink)
      }
    }
  }

  /** A `times`, `resb`, or `resw` count; 0 when it has no usable value (an error if emitting). */
  private count(line: TimesLine | DataLine, dollar: number, sink?: Sink): number {
    const op = line.operands[0]
    if (op?.kind !== 'imm') return 0
    const v = evaluateExact(op.expr, this.values, dollar)
    if (typeof v !== 'number') {
      if (sink !== undefined) this.unresolved(v, line.line, sink)
      return 0
    }
    if (Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT) return v
    const message = `\`${line.mnemonic}\` count must be 0..${MAX_COUNT}, not ${v}`
    sink?.diags.push(error(line.line, op, 'bad-directive', message))
    return 0
  }

  /** Zeros (DAT, ISA §6.2) up to the next multiple of the `align` value, a power of 2. */
  private align(line: DirectiveLine, here: number, sink?: Sink): number {
    const op = line.operands[0]
    if (op?.kind !== 'imm') return 0
    const v = evaluateExact(op.expr, this.values, here)
    if (typeof v !== 'number') {
      if (sink !== undefined) this.unresolved(v, line.line, sink)
      return 0
    }
    if (!Number.isSafeInteger(v) || v < 1 || v > CORE_SIZE || (v & (v - 1)) !== 0) {
      const message = `\`align\` needs a power of 2 up to ${CORE_SIZE}, not ${v}`
      sink?.diags.push(error(line.line, op, 'bad-directive', message))
      return 0
    }
    const pad = (v - (here % v)) % v
    sink?.zeros(pad)
    return pad
  }

  /** Why an `equ` has no value, if it has none: a cycle, or the error in its expression. */
  private checkEqu(line: EquLine, sink: Sink) {
    const { name } = line.label
    if (this.equs.get(name) !== line || this.values.has(name)) return
    const cycle = this.cycle(name)
    if (cycle !== undefined) {
      sink.diags.push(error(line.line, cycle.at, 'circular-equ', cycle.message))
      return
    }
    const expr = equExpr(line)
    const here = this.items[line.line - 1]?.address ?? 0
    const v = expr === undefined ? undefined : evaluateExact(expr, this.values, here)
    if (typeof v === 'object') this.unresolved(v, line.line, sink)
  }

  /**
   * Reports a missing value, unless it is an `equ` with none: the error is on the `equ`'s own
   * line, once, and not again at every use.
   */
  private unresolved(u: Unresolved, line: number, sink: Sink) {
    if (u.symbol !== undefined && this.equs.has(u.symbol)) return
    sink.diags.push(error(line, u, u.code, u.message))
  }

  /** The cycle through `name`, if `name` is on one. */
  private cycle(name: string): Cycle | undefined {
    this.cycles ??= findCycles(this.equs, this.order)
    return this.cycles.get(name)
  }

  /** Label addresses and `equ` values, in the order the source defines them. */
  symbols(): Map<string, number> {
    const symbols = new Map<string, number>()
    for (const { defines } of this.items) {
      const v = defines === undefined ? undefined : this.values.get(defines)
      if (defines !== undefined && v !== undefined) symbols.set(defines, v)
    }
    return symbols
  }
}

const UTF8 = new TextEncoder()

/** The expression an operand carries: a value, a displacement, or a target. */
function operandExpr(op: OperandAst): Expr | undefined {
  switch (op.kind) {
    case 'imm':
    case 'target':
      return op.expr
    case 'mem':
      return op.disp
    default:
      return undefined
  }
}

/** What the operands of one instruction share. */
interface Shared {
  /** The address of the instruction. */
  readonly at: number
  /** The size of an `auto` target. */
  readonly rel: Size
  /** The size a `byte` or `word` immediate gives the operation, for memory without one. */
  readonly opSize: Size | undefined
  /** A register or memory operand is 8-bit. */
  readonly byteOp: boolean
}

/**
 * The encoder input for an instruction: `rel` is the size of an `auto` target. An operand with
 * no value gets a stand-in: 0, in a 16-bit field unless `standIn`, since a value not known yet
 * may need one. With `standIn` every operand gets the stand-in, for the size of an instruction
 * whose values the encoder refuses.
 */
function instrInput(v: Placed, rel: Size, standIn: boolean): InstrInput {
  const { operands } = v.line
  // A size on an immediate is the size of the operation: `mov [bx], word 0`.
  const sized = operands.find((op): op is ImmAst => op.kind === 'imm' && op.size !== undefined)
  const byteOp = operands.some(
    (op) =>
      (op.kind === 'reg' && BYTE_REGISTERS.has(op.name)) || (op.kind === 'mem' && op.size === 8),
  )
  const shared: Shared = { at: v.at, rel, opSize: sized?.size, byteOp }
  return {
    mnemonic: v.line.mnemonic,
    prefix: v.line.prefix,
    operands: operands.map((op, i) =>
      operandInput(op, standIn ? undefined : v.values[i], !standIn, shared),
    ),
  }
}

/** One operand; with no value, a stand-in, whose field is 16-bit when `long`. */
function operandInput(
  op: OperandAst,
  value: number | undefined,
  long: boolean,
  shared: Shared,
): OperandInput {
  const guess = value === undefined && long
  switch (op.kind) {
    case 'reg':
      return op.name in Reg16
        ? { kind: 'reg16', reg: Reg16[op.name as keyof typeof Reg16] }
        : { kind: 'reg8', reg: Reg8[op.name as keyof typeof Reg8] }
    case 'imm':
      return { kind: 'imm', value: value ?? 0, size: immField(op, shared.byteOp, guess) }
    case 'mem': {
      const indexed = op.base !== undefined || op.index !== undefined
      return {
        kind: 'mem',
        base: op.base,
        index: op.index,
        disp: value ?? 0,
        dispSize: op.dispSize ?? (guess && indexed ? 16 : undefined),
        size: op.size ?? shared.opSize,
      }
    }
    case 'target': {
      const size = op.hint === 'short' ? 8 : op.hint === 'near' ? 16 : shared.rel
      return { kind: 'rel', target: value === undefined ? 0 : value - shared.at, size }
    }
    case 'str':
      throw new Error('internal error: a string operand in an instruction')
  }
}

/**
 * The immediate field to ask the encoder for; undefined lets it choose. `strict` pins it. As in
 * NASM, `byte` asks for a byte field (`add ax, byte 5` is `83 C0 05`, `mov ax, byte 5` an error),
 * and `word` on a byte operation is a size mismatch (`mov al, word 5`).
 */
function immField(op: ImmAst, byteOp: boolean, guess: boolean): Size | undefined {
  if (op.strict) return op.size
  if (op.size === 8) return 8
  if (op.size === 16 && byteOp) return 16
  return guess ? 16 : undefined
}

/** An encoder error, at the operand it names or else at the whole statement. */
function encodeError(e: EncodeError, line: InstrLine): Diag {
  const at = (e.operand === undefined ? undefined : line.operands[e.operand]) ?? line
  return error(line.line, at, e.code, e.message)
}

function noConvergence(item: Item): Diag {
  const message = `assembly did not converge: the size of this line still changed in pass ${MAX_PASSES}`
  return error(item.line.line, item.line, 'no-convergence', message)
}

/** The value of an `equ`. */
function equExpr(line: EquLine): Expr | undefined {
  const op = line.operands[0]
  return op?.kind === 'imm' ? op.expr : undefined
}

/** The symbols `e` uses, each with its first use, left to right. */
function uses(e: Expr, out: Map<string, SymExpr> = new Map()): Map<string, SymExpr> {
  if (e.kind === 'sym' && !out.has(e.name)) out.set(e.name, e)
  else if (e.kind === 'unary') uses(e.arg, out)
  else if (e.kind === 'binary') {
    uses(e.left, out)
    uses(e.right, out)
  }
  return out
}

/** The `equ`s that the `equ` of `line` uses, each at its first use. */
function equUses(line: EquLine, equs: ReadonlyMap<string, EquLine>): SymExpr[] {
  const expr = equExpr(line)
  return expr === undefined ? [] : [...uses(expr).values()].filter((s) => equs.has(s.name))
}

/**
 * The `equ`s in an order where each comes after the `equ`s it uses (Kahn's algorithm), so one
 * sweep computes them all. One on a cycle, or that uses one on a cycle, is left out.
 */
function equOrder(equs: ReadonlyMap<string, EquLine>): EquLine[] {
  const waiting = new Map<string, number>()
  const users = new Map<string, string[]>()
  for (const [name, line] of equs) {
    const deps = equUses(line, equs)
    waiting.set(name, deps.length)
    for (const d of deps) {
      const list = users.get(d.name)
      if (list === undefined) users.set(d.name, [name])
      else list.push(name)
    }
  }
  const ready = [...equs.keys()].filter((name) => waiting.get(name) === 0)
  const order: EquLine[] = []
  for (let i = 0; i < ready.length; i++) {
    const name = ready[i] as string
    order.push(equs.get(name) as EquLine)
    for (const user of users.get(name) ?? []) {
      const left = (waiting.get(user) ?? 0) - 1
      waiting.set(user, left)
      if (left === 0) ready.push(user)
    }
  }
  return order
}

/** An `equ` on a cycle: the error, at its use of the next `equ` on the cycle. */
interface Cycle {
  readonly at: Span
  readonly message: string
}

/** The longest cycle a message spells out. */
const CYCLE_NAMES = 6

/**
 * The `equ`s on a cycle. From each `equ` left out of the order, it follows the first `equ` it
 * uses that is also left out; every step is a real use, so a loop it finds is a real cycle, and
 * every walk ends in one. An `equ` that only uses a cycle is not on it.
 */
function findCycles(
  equs: ReadonlyMap<string, EquLine>,
  order: readonly EquLine[],
): Map<string, Cycle> {
  const ordered = new Set(order.map((line) => line.label.name))
  const next = new Map<string, SymExpr>()
  for (const [name, line] of equs) {
    const use = ordered.has(name)
      ? undefined
      : equUses(line, equs).find((s) => !ordered.has(s.name))
    if (use !== undefined) next.set(name, use)
  }
  const cycles = new Map<string, Cycle>()
  const done = new Set<string>()
  for (const start of next.keys()) {
    const path: string[] = []
    const onPath = new Set<string>()
    let name: string | undefined = start
    while (name !== undefined && !done.has(name) && !onPath.has(name)) {
      path.push(name)
      onPath.add(name)
      name = next.get(name)?.name
    }
    if (name !== undefined && onPath.has(name)) {
      const loop = path.slice(path.indexOf(name))
      for (const [i, member] of loop.entries()) {
        const shown = Array.from(
          { length: Math.min(loop.length, CYCLE_NAMES) },
          (_, j) => loop[(i + j) % loop.length] as string,
        )
        if (loop.length > CYCLE_NAMES) shown.push('…')
        const via = loop.length === 1 ? '' : `: ${[...shown, member].join(' → ')}`
        const at = next.get(member) as SymExpr
        cycles.set(member, { at, message: `\`${member}\` is defined in terms of itself${via}` })
      }
    }
    for (const p of path) done.add(p)
  }
  return cycles
}

/** One listing line per source line, from the addresses and sizes of the last pass. */
function listing(items: readonly Item[], bytes: Uint8Array, source: string): ListingLine[] {
  const texts = source.split(/\r\n|\r|\n/)
  return items.map((item, i) => {
    const own = bytes.subarray(item.address, item.address + item.size)
    return {
      lineNo: item.line.line,
      address: item.address,
      bytes: own,
      bytesHex: bytesHex(own),
      source: texts[i] ?? '',
    }
  })
}

/** The source line of each byte; a line past 65535 reads as 65535. */
function sourceMap(items: readonly Item[], length: number): Uint16Array {
  const map = new Uint16Array(length)
  for (const item of items) {
    map.fill(Math.min(item.line.line, 0xffff), item.address, item.address + item.size)
  }
  return map
}
