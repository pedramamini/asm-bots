# 04 — Instruction Set

This doc is the contract between the assembler and the execution engine.
If the new implementation matches everything here, the bots in
[`bots/`](bots/) will run.

## Encoding

Instructions are **byte streams**, not fixed-width words. Each instruction
starts with a 1-byte **opcode**; the opcode determines how many operand
bytes follow.

| Family | Opcode range | Total size | Operand layout |
|---|---|---|---|
| NOP / HALT / RET | `0x00`, `0xFF`, `0x43` | **1 byte** | none |
| MOV / arithmetic / logical | `0x10–0x11`, `0x20–0x23`, `0x50–0x52` | **3 bytes** | `[opcode][op1][op2]` (each op = 1 byte: register index 0–3, or immediate) |
| INC / DEC / NOT / PUSH / POP | `0x60`, `0x61`, `0x53`, `0x40`, `0x41` | **2 bytes** | `[opcode][op]` |
| Jumps / Calls / SPL | `0x30–0x38`, `0x42`, `0xA0` | **3 bytes** | `[opcode][addr_lo][addr_hi]` (16-bit little-endian target) |
| CMP / TEST | `0x70`, `0x71` | **3 bytes** | `[opcode][op1][op2]` |
| LOAD / STORE / LEA | `0x90`, `0x91`, `0x80` | **3 bytes** | `[opcode][addr_or_reg][addr_or_reg]` |
| DAT (data bomb) | `0xF0`, `0xF1` (db) | varies | data definition; executing it terminates the process |

> **Heads up:** the prior prototype's exact byte sizing has some quirks
> (single-operand `inc r0` is logged as 3 bytes when it should be 2). When
> in doubt, the **CodeGenerator's** `calculateInstructionSize()` is the
> authority. The new implementation should pick a consistent rule and
> document it; the old code's rule was effectively "jumps/calls/spl/data
> are always 3 bytes; arithmetic and mov with 2 operands are 3 bytes; HALT
> is 1; everything else is 1 + operand_count."

## Opcode table

```
─── Basic ───────────────────────────────────────
0x00  NOP             ; do nothing
0xFF  HALT            ; terminate this process

─── Data movement ───────────────────────────────
0x10  MOV  dest, src  ; reg→reg, imm→reg, reg→mem, mem→reg
0x11  XCHG r1, r2     ; swap two registers

─── Arithmetic ──────────────────────────────────
0x20  ADD  dest, src  ; dest += src   (16-bit wrap)
0x21  SUB  dest, src  ; dest -= src
0x22  MUL  dest, src  ; dest *= src
0x23  DIV  dest, src  ; dest /= src   (div-by-zero → 0)

─── Logical ─────────────────────────────────────
0x50  AND  dest, src
0x51  OR   dest, src
0x52  XOR  dest, src
0x53  NOT  dest

─── Increment / decrement ───────────────────────
0x60  INC  reg
0x61  DEC  reg

─── Comparison ──────────────────────────────────
0x70  CMP  a, b       ; sets r0 to (b - a) [see "Flags vs r0" note]
0x71  TEST a, b       ; bitwise AND, sets flags only

─── Jumps (16-bit absolute target) ──────────────
0x30  JMP  addr       ; unconditional
0x31  JZ   addr       ; if r0 == 0      (alias JE)
0x32  JNZ  addr       ; if r0 != 0      (alias JNE)
0x33  JE   addr       ; alias for JZ
0x34  JNE  addr       ; alias for JNZ
0x35  JL   addr       ; if r0 high bit set (treated as negative)
0x36  JG   addr       ; if r0 != 0 and high bit clear
0x37  JGE  addr       ; if not JL
0x38  JLE  addr       ; if JL or JZ

─── Stack ───────────────────────────────────────
0x40  PUSH src        ; sp -= 2; mem[sp] = src
0x41  POP  dest       ; dest = mem[sp]; sp += 2
0x42  CALL addr       ; push pc+3; jump
0x43  RET             ; pop addr; jump

─── Memory ──────────────────────────────────────
0x80  LEA  dest, addr ; dest = addr (load effective address)
0x90  LOAD addr, reg  ; reg = mem[addr]
0x91  STORE reg, addr ; mem[addr] = reg

─── Special ─────────────────────────────────────
0xA0  SPL  addr       ; spawn a new process at addr (parent continues)
0xF0  DAT  value      ; data word; executing this terminates the process
0xF1  DB   value      ; data byte (no terminate; just a single byte of data)
```

## Operand semantics — one byte per operand

For non-jump instructions, each operand byte is interpreted as follows:

| Value `v` | Meaning |
|---|---|
| `0..3` | Register `r0..r3` |
| `4..6` | Special register: `4=sp`, `5=pc`, `6=flags` |
| `>= 7` | Immediate value (or memory address, depending on instruction) |

Jump-family instructions encode a **16-bit absolute target** in two bytes
(little endian) after the opcode.

Memory references via `[addr]`, `[reg]`, or `[reg+offset]` are encoded as
**16-bit values with the high bit set** (`0x8000 | ...`):

| Encoding | Meaning |
|---|---|
| `0x8000 | reg_code` | `[reg]` indirect |
| `0x8000 | (reg_code << 8) | offset` | `[reg + offset]` indexed |
| `0x8000 | addr` | `[addr]` direct (`addr` is the low 15 bits) |

These are passed in the operand stream. The execution unit must inspect
the high bit to distinguish "memory ref" from "immediate value or reg
index."

## Execution semantics

### MOV (0x10)

```
mov dest, src
```

- If `src < 4` and `dest < 4`: register-to-register copy.
- If `src < 4`: register `src` value into register `dest`.
- If `dest < 4` and `src` is a memory ref: load from memory into register.
- If `dest` is a memory ref: store value to memory.
- Immediate-to-register: when `src` is a literal, write it to `dest`.

In short: the engine inspects each operand and decides "register? immediate?
memory ref?" then dispatches.

### Arithmetic (0x20–0x23)

`dest = dest <op> src`, all modulo `0x10000` (16-bit wrap). Division by
zero yields `0`.

### Comparison (0x70 CMP)

The original prototype writes `b - a` into **r0** instead of using flags.
That is the de-facto contract — bots like `simple_hunter`, `vampire`, and
`fortress` rely on `r0` being set after `cmp` so subsequent `jz/jl/jg`
work. **For the rebuild**: maintain this. `cmp a, b` sets `r0 = (b - a) &
0xFFFF`; conditional jumps inspect `r0` (zero / high bit). Jumps **do not**
look at a separate flags register.

If you want a real flags register later, fine — but don't change the bot
contract. CMP must still produce a value the existing JZ/JL/JG sequences
consume.

### Jumps

- 16-bit absolute target.
- Some bots use small relative-looking targets (e.g., `jmp scan` where
  `scan` resolves to a small symbol value). The prototype does a
  *heuristic*: "if target < 0x100, treat as offset within current segment;
  else treat as absolute." This is **fragile** and the rebuild should
  drop it — instead, fix the assembler so all jump targets are resolved to
  absolute addresses post-relocation.
- High bits of PC (above 16) are preserved when jumping. Treat PC as a
  full 32-bit register but only use the low 16 for memory access. (The
  prototype does this to support hypothetical larger memories without
  changing register width.)

### CALL / RET

- `call`: push `pc + 3` (the size of the CALL instruction) to the stack
  (16-bit, little-endian); set PC to target.
- `ret`: pop 16-bit address from stack; set PC.
- Stack grows **downward** from `0xFFFF` (initial SP). Each push subtracts
  2 from SP before writing.

### SPL (0xA0)

Spawn a new process for the **same owner/bot** with PC at the target
address. The parent's PC advances normally to the next instruction.
Children share the same memory segments (no copy). Subject to the global
process cap (32 default). If the cap is reached, SPL silently fails (does
not terminate).

### DAT (0xF0)

Executing a `DAT` byte terminates the executing process. This is the
classic Core War "bomb" — bots scatter `DAT` instructions in opponents'
code so when the opponent's PC reaches one, that process dies.

`DB` (0xF1) is a single data byte; executing it just runs as opcode `0xF1`,
which is unknown to the engine. The engine should treat unknown opcodes as
**no-ops that advance PC**, not as errors. (See "Unknown opcode policy"
below.)

### HALT (0xFF)

Terminates the executing process. Different from DAT in that it's
intentional, not a trap.

## Unknown opcode policy

If the byte at PC is not in the opcode table:

- The prototype logs `unknown(0x??)` and treats it as NOP (advance PC by
  1). It does **not** terminate the process.
- This is intentional: it makes battles "interesting" by letting processes
  walk through garbage memory without instantly dying.
- For the rebuild: keep this policy. It's important for the gameplay feel
  — a bot scanning enemy code shouldn't die just because the bytes happen
  to decode to something nonsensical.

## Addressing modes (Redcode-style "@", "<", "#")

The original Core War addressing modes (`#` immediate, `@` indirect, `<`
predecrement) are referenced in the `BOT_LANGUAGE.md` doc but **not
actually implemented**. The shipped assembler accepts:

- `r0`, `ax`, etc. — register
- `123`, `0xFF` — immediate
- `[reg]`, `[reg+offset]`, `[addr]` — memory access via brackets
- `#42` — immediate (alternate syntax; the parser accepts `#`-prefix)

That's it. **Do not** try to implement Redcode addressing modes; the bots
don't use them. Document the bracket syntax as the canonical memory access
form.

## Word-level write semantics

The engine writes **byte at a time**. When a bot does `mov [addr], 0xFFFF`,
the prototype writes only the low byte (`0xFF`) to `mem[addr]`. There is
no auto-promotion to a 16-bit store.

To write a 16-bit value, the bot must do two stores (or use the
"effective" pattern: store low byte, increment, store high byte). For
simplicity, the rebuild may add `STORE16/LOAD16` opcodes — but **do not**
change the existing MOV semantics, or existing bots will break.
