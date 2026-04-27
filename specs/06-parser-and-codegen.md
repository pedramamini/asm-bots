# 06 — Parser & Code Generator

This is the toolchain: source text → tokens → instructions → bytes ready
to load into memory. Two stages: **AssemblyParser** and **CodeGenerator**.

## Stage 1: AssemblyParser

Input: a `string` (the contents of a `.asm` file).
Output: `{ tokens, errors, symbols }`.

### Algorithm

Two passes over the source.

**Pass 1 — Symbol collection.**
Walk every line, tracking `currentAddress` (starts at 0). For each line:

- Skip comments and blanks.
- If line ends with `:`, record the label → `currentAddress`.
- If the line begins with a directive (`.code`, `.data`, etc.), update
  internal mode flags. Capture metadata strings.
- If the line is a label-with-data (`trap: dw 0xAAAA`), record the label
  AND increment `currentAddress` by the data size.
- If the line is `name equ value`, record `name → value` (no address
  bump).
- If the line is an instruction, increment `currentAddress` by 1 (the
  prototype's pass-1 sizing is a simplification — a known bug, since
  jump/call/etc. are 3 bytes, not 1. The actual byte layout is computed
  later in CodeGenerator. The label addresses produced by pass 1 are
  *symbolic* offsets and get rewritten by `relocate()`).

The simplification works because *every* address in pass 1 is offset by
the same constant during `relocate(M)`. As long as relative ordering is
correct, the absolute values are fixed up at load time.

**Pass 2 — Tokenization.**
Walk lines again and emit a `Token[]`:

- Labels → `{ type: 'Label', value: name }`
- Directives → `{ type: 'Directive', value: '.name' }` followed by
  operand tokens.
- `name equ value` → `Label`, `DataDefinition('equ')`, `Immediate(value)`.
- `name dw value [, value ...]` → `Label`, `DataDefinition('dw')`,
  `Immediate(value)`, `Immediate(value)`, ...
- `instruction operand1, operand2` → `Instruction`, then operand tokens
  in order.

Operands are tokenized one at a time:

- `[stuff]` → `MemoryAccess`. The contents (`stuff`) are kept as a string
  in `value`.
- `#42` or `#0xFF` → `Immediate`.
- `0xFF` or `$FF` or `123` → `Immediate`.
- `$` (alone) → `Symbol` with value `"$"` (the assembler's "current
  address" sigil).
- A register name → `Register`.
- An identifier matching no register → `Symbol` (forward reference to a
  label or equate).

### Errors

The parser collects errors into an array rather than throwing. Callers
must check `errors.length` before proceeding. Errors include:

- Unknown directive
- Unknown instruction
- Invalid number / hex
- Invalid identifier
- Invalid operand

### Predefined symbols

The parser pre-loads:
- `defense_start` = `0x300` (legacy; `fortress` bot uses this)
- `$` = `0` (gets updated as pass 1 walks)

You can drop `defense_start` from the predefined set if you don't need
backwards compatibility with the old `fortress.asm`. The fortress bot
also defines `defense_start equ 0x300` itself, so it works either way.

## Stage 2: CodeGenerator

Input: `Token[]` and `SymbolTable`.
Output: `GeneratedCode = { segments: MemorySegment[], entryPoint: number }`.

### `encode(tokens, symbols) -> Instruction[]`

Walks tokens left-to-right. For each instruction token, slurps following
operand tokens until it hits a non-operand. Each operand is encoded:

- `Register` → register code (`r0=0`, ..., `sp=4`, `ax=0`, etc.)
- `Immediate` → numeric value
- `Symbol` → `symbols[value]` (or `0` if unresolved)
- `MemoryAccess` → 16-bit value with the high bit set:
  - `[reg]` → `0x8000 | reg_code`
  - `[reg+offset]` → `0x8000 | (reg_code << 8) | (offset & 0xFF)`
  - `[addr]` → `0x8000 | (addr & 0x7FFF)`
  - `[symbol]` → `0x8000 | symbols[symbol]`

Each emitted `Instruction` has:
```ts
{ opcode: number, operands: number[], size: number }
```

`size` comes from a switch:
- HALT → 1
- Jumps (0x30–0x38), CALL → 3
- MOV/arith with two operands → 3
- Otherwise → 1 + operand count

For data definitions:
- `dw value` → `{ opcode: 0xF0, operands: [low, high], size: 2 }`
- `db value` → `{ opcode: 0xF1, operands: [value & 0xFF], size: 1 }`

### `layout(instructions, symbols) -> GeneratedCode`

Concatenates instructions into a single byte array (one segment named
`code`) starting at `baseAddress` (initially 0). Per-instruction logic:

- Push opcode byte.
- For jumps (0x30–0x38) and CALL (0x42): push the 16-bit target
  little-endian (low byte, high byte).
- For DAT/DB: push the operands as-is.
- For other instructions: push each operand. If any operand is > 255,
  push it as 2 bytes little-endian; else push 1 byte.

Returns:
```ts
{
  segments: [{
    name: 'code',
    start: baseAddress,
    size: byteCount,
    data: Uint8Array
  }],
  entryPoint: symbols['start'] || baseAddress
}
```

### `relocate(baseAddress)`

The crucial step. The bot has been encoded as if it lived at address 0;
to actually load it at `M`, every absolute reference in the byte stream
must be rewritten.

Walk the byte stream looking for jump/call/SPL opcodes:

```
opcode in {0x30..0x38, 0x42, 0xA0}
```

For each, the next two bytes are a relative-to-segment-start address.
Rewrite them as `segment.start + that_address` (little endian).

Also shift every entry in the symbol table by `+offset`.

After `relocate`, the segment's bytes are ready to splat into memory at
`segment.start`.

## Loading sequence (BattleSystem)

```ts
function loadBot(filePath, owner) {
  const code = readFile(filePath)
  const { tokens, errors, symbols } = parser.parse(code)
  if (errors.length) throw ...

  const instructions = codegen.encode(tokens, symbols)
  let layout = codegen.layout(instructions, symbols)

  const M = randomBase()
  codegen.relocate(M)

  // entry point fix: post-relocate, point at the first segment's start
  layout.entryPoint = layout.segments[0].start

  const pid = processManager.create({
    name, owner, memorySegments: layout.segments,
    entryPoint: layout.entryPoint,
    priority: 1, quantum: 5,
  })

  memory.setCurrentProcess(pid)
  for (const seg of layout.segments) {
    for (let i = 0; i < seg.size; i++) {
      memory.write(seg.start + i, seg.data[i])
    }
  }
  memory.setCurrentProcess(null)

  battleController.addProcess(pid)
  return { pid, name, owner, entryPoint: layout.entryPoint, ... }
}
```

## What the prototype gets wrong here (be aware)

1. **Pass-1 sizing.** Pass 1 increments `currentAddress` by 1 per
   instruction even though jumps are 3 bytes. The prototype gets away with
   this because pass-1 addresses are never used as absolute values — they
   feed `relocate()`, which re-derives absolute addresses from segment
   starts. But it makes the symbol table values opaque ("relative offsets
   in some weird unit") rather than meaningful byte addresses. **Fix in
   the rebuild:** make pass 1 do real byte sizing, so symbol values are
   real byte offsets.

2. **`encode()` re-uses `symbols`.** The symbols passed into `encode()`
   are pre-relocation. After `relocate()`, the symbol table is mutated.
   If anyone calls `encode()` again with the post-relocation symbols, all
   values are wrong. **Fix:** keep the encoded `Instruction[]` and only
   relocate the byte stream, never re-encode.

3. **`layout()` is called both before and after `relocate()`.** The
   WebSocket server's `createProcessForBattle()` does this. It only sort-
   of works because `layout()` is mostly idempotent. **Fix:** clearly
   separate "encode + initial layout" (one-time) from "relocate" (one-
   time). Don't call `layout()` twice.

4. **Heuristic jump-target interpretation in the executor.** The exec
   unit checks `if target < 0x100, treat as relative`. This compensates
   for the assembler emitting un-relocated targets in some edge cases.
   **Fix:** make the assembler always emit absolute post-relocation
   targets, and drop the runtime heuristic.

5. **No string support in `db`.** The doc says you can `string: db
   "Hello"`, but the parser doesn't actually decompose the string into
   bytes. **Fix:** either implement it or remove from the spec.
