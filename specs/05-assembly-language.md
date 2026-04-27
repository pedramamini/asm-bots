# 05 — Assembly Language (source-level)

This is the language a player types into a `.asm` file. It is **case-
insensitive** for keywords, instructions, and registers. Labels are
case-sensitive.

## File structure

```assembly
; Comments start with semicolons and run to end of line.

; Optional metadata directives (.name, .author, .version, .strategy).
.name "Hunter"
.author "Roo"
.version "1.0"
.strategy "Active scanner with bombing fallback"

; Section directive (optional; default is .code).
.code

; Code, labels, and data go here.
start:
    mov r0, 0x100
    jmp start
```

The first line of actual code (after directives, comments, blank lines)
becomes the entry point unless an explicit `start:` label exists. The
assembler resolves the entry point as **`symbols['start']`** if defined,
otherwise the lowest code address.

## Lexical rules

- **Whitespace** is insignificant except between tokens. Tabs and spaces
  are equivalent.
- **Comments**: `;` to end of line.
- **Identifiers**: `[A-Za-z_][A-Za-z0-9_]*`.
- **Numbers**:
  - Decimal: `123`, `-7`
  - Hex with `0x` prefix: `0xFF`, `0x1234`
  - Hex with `$` prefix: `$FF` (Motorola style; supported)
- **String literals**: double-quoted, used by `.name`, `.author`,
  `.version`, `.strategy` only.
- **Comma** is a token separator (interchangeable with whitespace). Both
  `mov r0, r1` and `mov r0 r1` parse identically.

## Directives

| Directive | Purpose | Example |
|---|---|---|
| `.name "..."` | Bot display name | `.name "Vampire"` |
| `.author "..."` | Author credit | `.author "Roo"` |
| `.version "..."` | Version string | `.version "1.0"` |
| `.strategy "..."` | Free-text strategy description | `.strategy "Replicate"` |
| `.code` | Following lines are code | `.code` |
| `.data` | Following lines are data | `.data` |
| `.const` | Following lines are constants (read-only data) | `.const` |
| `.org N` | Set origin (where the next byte is laid out) | `.org 0x100` |
| `.align N` | Pad to N-byte boundary | `.align 2` |
| `.space N` | Reserve N bytes (zero-filled) | `.space 16` |
| `.include "lib.inc"` | Include another file | `.include "macros.inc"` |

The reference prototype only fully implements `.name/.author/.version/
.strategy/.code/.data/.const`. The other directives are accepted by the
parser but **not honored** by the code generator. For the rebuild,
implement them or remove from the spec.

## Labels

```assembly
loop:                 ; Code label — resolves to current address
    inc r0
    jmp loop

trap: dw 0xAAAA       ; Data label — same syntax, but address points at the dw
```

Labels can appear on their own line or in front of an instruction or data
definition. They are stored in the symbol table with their byte address
(post-relocation).

Special label `start:` (lowercase) is the conventional entry point.

## Special symbols

- `$` — current address (whatever the assembler's "place pointer" is).
- `code_size equ $ - start` — common idiom: compute total bot size at
  assembly time.

## Data definitions

```assembly
db 0x42                ; one byte
dw 0x1234              ; one word (16-bit, little-endian)
dq 0x12345678          ; one quad (32-bit) — accepted but not all
                       ; codegen paths emit it; safest to avoid

string: db "Hello"     ; (BOT_LANGUAGE.md mentions this; the prototype's
                       ;  parser does NOT actually handle string literals
                       ;  in db. Don't use this in v1; flag in tests.)

array: dw 1, 2, 3, 4   ; multiple values on one line

trap: dw 0xAAAA        ; data label
dat: dw 0xFFFF         ; "death byte" data label
```

The `dat` *label* (lowercase) is just a label by convention — it points at
a data word that, when executed as code, is treated as the `DAT` opcode
(0xF0) and terminates whichever process is reading it. Multiple bots use
this idiom for "drop a bomb."

## Equates

```assembly
defense_start equ 0x300       ; Compile-time constant
code_size     equ $ - start   ; Computed at assembly time
```

`equ` does NOT allocate memory; it just adds the symbol to the table with
the given value.

## Instructions

See [`04-instruction-set.md`](04-instruction-set.md) for full opcode list.
The full list of mnemonics the parser accepts:

```
mov, add, sub, mul, div,
jmp, jz, jnz, je, jne, jl, jg, jge, jle,
push, pop, call, ret,
and, or, xor, not,
inc, dec, nop, halt,
cmp, spl, dat,
test, lea, xchg
```

## Registers

| Canonical | x86 alias | Notes |
|---|---|---|
| `r0` | `ax` | Primary accumulator |
| `r1` | `bx`, `si` | Base / index |
| `r2` | `cx`, `di` | Count / index |
| `r3` | `dx` | Data |
| `sp` | — | Stack pointer (16-bit; init `0xFFFF`) |
| `pc` | — | Program counter (read-only in source) |
| `flags` | — | Reserved (CMP writes to r0 instead) |

The aliases (`ax`, `bx`, `cx`, `dx`, `si`, `di`) all just map to the same
physical registers. Use whichever style you prefer; bots in this codebase
mix them.

## Memory access syntax

```assembly
mov ax, [0x100]      ; Direct address
mov ax, [bx]         ; Indirect through register
mov ax, [bx + 16]    ; Indexed: address = bx + 16
mov ax, [bx + cx]    ; Base + index — accepted by parser but
                     ;   only the (reg + literal) form is fully wired
                     ;   in codegen. Avoid in v1.
```

The `word` keyword (e.g., `mov word [bx], trap`) is accepted as a
modifier and silently ignored by the prototype. The `fortress` bot uses
this syntax — preserve compatibility, but treat `word` as a no-op token.

## Conditional assembly & macros

The `BOT_LANGUAGE.md` doc lists `#if`, `#ifdef`, `#macro` — **none of
these are implemented**. Do not implement in v1.

## Worked example: Counter

```assembly
; Counts from 1 to 100, then loops forever.
mov r0, 1
main_loop:
  inc r0
  cmp r0, 100
  jl main_loop      ; If r0 < 100, loop
  mov r0, 0
  jmp main_loop
```

After parsing, the symbol table has `main_loop -> 3` (or whatever
address `inc r0` lands on). After `relocate(M)`, that becomes `M + 3`,
and the `jl` and `jmp` operands are updated to point at it.

## What the parser produces

```ts
type Token = {
  type: 'Label' | 'Instruction' | 'Immediate' | 'Symbol' |
        'Register' | 'Directive' | 'MemoryAccess' |
        'StringLiteral' | 'DataDefinition'
  value: string
  line: number
}

type ParseResult = {
  tokens: Token[]
  errors: { message: string, line: number }[]
  symbols: { [label: string]: number }   // address values
}
```

The parser does a **two-pass walk**:
1. Pass 1 collects labels and computes `currentAddress` per logical
   instruction (so labels resolve correctly even with forward references).
2. Pass 2 emits the token stream, with operand tokens appearing right
   after their instruction token.

See [`06-parser-and-codegen.md`](06-parser-and-codegen.md) for details.
