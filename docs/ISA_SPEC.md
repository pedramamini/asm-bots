---
type: reference
title: ASM Bots ISA Specification (x16c v1)
created: 2026-09-21
status: frozen
tags:
  - asm-bots
  - isa
  - 8086
  - spec
related:
  - '[[ARCHITECTURE]]'
  - '[[RESEARCH_BRIEF]]'
---

# ASM Bots ISA Specification: x16c v1

This document is the contract between the assembler, the disassembler, the engine, the debugger, and every bot ever written. It is **frozen**. Changes require a version bump (`x16c v2`) and a migration note. Every implementer reads this first and treats it as authoritative over any other document.

## 0. Design principles

1. **It is real 8086 machine code.** Every byte sequence the assembler emits is valid Intel 8086 encoding for the supported subset, with exactly three documented divergences (section 9). `ndisasm -b16` decodes our binaries. A player can use any x86 reference. `nasm -f bin` can assemble a bot.
2. **One codec.** Encoding and decoding live in one module (`packages/codec`) driven by one opcode table. The assembler, the disassembler, the engine fetch stage, and the debugger all import it. There is no second opinion about instruction length anywhere in the codebase.
3. **The core is a minefield.** Memory is zeroed. Opcode `0x00` is DAT. Executing it kills the process. Undefined opcodes kill the process. Walking off your code kills you.
4. **Everything wraps.** Addresses mod 65536, values mod 65536 (or 256 for byte ops). There are no faults, only deaths.
5. **Deterministic.** Given (bot binaries, load addresses, config), a battle produces one outcome. The only randomness is bot placement, drawn from a seeded PRNG.

## 1. Machine model

| Item | Value |
|---|---|
| Core size | 65,536 bytes (`0x0000`..`0xFFFF`), one flat address space, no segments |
| Cell | 1 byte |
| Word | 16-bit, little-endian, may straddle `0xFFFF`/`0x0000` (wraps) |
| Registers (16-bit) | `AX BX CX DX SI DI BP SP IP FLAGS` |
| Registers (8-bit) | `AL AH BL BH CL CH DL DH` (halves of AX BX CX DX) |
| Flags used | `CF` (bit 0), `PF` (bit 2), `AF` (bit 4), `ZF` (bit 6), `SF` (bit 7), `DF` (bit 10), `OF` (bit 11). Bit 1 always reads 1. Others read 0. |
| Instruction length | 1 to 6 bytes (prefix + opcode + modrm + disp + imm) |

Register encoding (x86 order, used in ModR/M `reg` and `rm` fields and in `+r` opcodes):

| Code | 16-bit | 8-bit |
|---|---|---|
| 0 | AX | AL |
| 1 | CX | CL |
| 2 | DX | DL |
| 3 | BX | BL |
| 4 | SP | AH |
| 5 | BP | CH |
| 6 | SI | DH |
| 7 | DI | BH |

## 2. Encoding

Standard 8086 16-bit encoding. Only the parts listed here are supported.

### 2.1 Instruction layout

```
[prefix]? [opcode] [modrm]? [disp8 | disp16]? [imm8 | imm16]?
```

Supported prefixes: `F2` (REPNE/REPNZ), `F3` (REP/REPE/REPZ). At most one prefix. A prefix not followed by a string instruction is undefined (kills). Segment override prefixes (`26 2E 36 3E`) and `F0` LOCK are undefined (kill).

### 2.2 ModR/M byte (16-bit addressing)

```
 7 6   5 4 3   2 1 0
 mod    reg     rm
```

| mod | Meaning |
|---|---|
| 00 | memory, no displacement, except `rm=110` which is `[disp16]` |
| 01 | memory, `+ disp8` (sign-extended) |
| 10 | memory, `+ disp16` |
| 11 | register operand (`rm` is a register code) |

| rm | Effective address (mod 00/01/10) |
|---|---|
| 000 | `[BX+SI]` |
| 001 | `[BX+DI]` |
| 010 | `[BP+SI]` |
| 011 | `[BP+DI]` |
| 100 | `[SI]` |
| 101 | `[DI]` |
| 110 | `[BP]` (mod 01/10) or `[disp16]` (mod 00) |
| 111 | `[BX]` |

`[BP]` with no displacement is encoded as `mod=01, rm=110, disp8=0` (exactly like real 8086 and NASM).

The `reg` field holds either a register code or an opcode extension (`/0`..`/7`) for group opcodes.

### 2.3 Immediates and displacements

Little-endian. `disp8` and `imm8` in sign-extending contexts (`83`, `6B`, `Jcc`, `EB`, `E0`..`E3`, `60`) are signed. `imm8` in `B0+r`, `C6`, `80`, `D0`..`D3`, `A8` is a raw byte.

## 3. Opcode table

Notation: `/r` = ModR/M with register in `reg`; `/n` = ModR/M with extension n; `+r` = register added to opcode; `ib`/`iw` = imm8/imm16; `cb`/`cw` = signed rel8/rel16 relative to the address of the next instruction. `r/m8`, `r/m16` = register or memory per ModR/M.

### 3.1 Data movement

| Bytes | Mnemonic | Notes |
|---|---|---|
| `88 /r` | `MOV r/m8, r8` | |
| `89 /r` | `MOV r/m16, r16` | |
| `8A /r` | `MOV r8, r/m8` | |
| `8B /r` | `MOV r16, r/m16` | |
| `8D /r` | `LEA r16, m` | mod=11 is undefined |
| `A0 iw` | `MOV AL, [moffs16]` | |
| `A1 iw` | `MOV AX, [moffs16]` | |
| `A2 iw` | `MOV [moffs16], AL` | |
| `A3 iw` | `MOV [moffs16], AX` | |
| `B0+r ib` | `MOV r8, imm8` | |
| `B8+r iw` | `MOV r16, imm16` | |
| `C6 /0 ib` | `MOV r/m8, imm8` | |
| `C7 /0 iw` | `MOV r/m16, imm16` | |
| `86 /r` | `XCHG r/m8, r8` | |
| `87 /r` | `XCHG r/m16, r16` | |
| `90+r` | `XCHG AX, r16` | `90` is NOP |
| `50+r` | `PUSH r16` | SP -= 2; [SP] = r16. `PUSH SP` pushes the pre-decrement value (8086 behavior) |
| `58+r` | `POP r16` | |
| `FF /6` | `PUSH r/m16` | |
| `8F /0` | `POP r/m16` | |
| `9C` | `PUSHF` | |
| `9D` | `POPF` | only the flags listed in section 1 are writable |
| `9E` | `SAHF` | |
| `9F` | `LAHF` | |
| `98` | `CBW` | |
| `99` | `CWD` | |

### 3.2 Arithmetic and logic

Group pattern for `ADD OR ADC SBB AND SUB XOR CMP` (op index n = 0..7 in that order):

| Bytes | Form |
|---|---|
| `(n<<3)+00 /r` | `op r/m8, r8` (**`00` is DAT, see section 9**) |
| `(n<<3)+01 /r` | `op r/m16, r16` |
| `(n<<3)+02 /r` | `op r8, r/m8` |
| `(n<<3)+03 /r` | `op r16, r/m16` |
| `(n<<3)+04 ib` | `op AL, imm8` |
| `(n<<3)+05 iw` | `op AX, imm16` |
| `80 /n ib` | `op r/m8, imm8` |
| `81 /n iw` | `op r/m16, imm16` |
| `83 /n ib` | `op r/m16, imm8` (sign-extended) |

Other:

| Bytes | Mnemonic |
|---|---|
| `84 /r` | `TEST r/m8, r8` |
| `85 /r` | `TEST r/m16, r16` |
| `A8 ib` | `TEST AL, imm8` |
| `A9 iw` | `TEST AX, imm16` |
| `F6 /0 ib` | `TEST r/m8, imm8` |
| `F7 /0 iw` | `TEST r/m16, imm16` |
| `F6 /2` `F7 /2` | `NOT r/m8`, `NOT r/m16` |
| `F6 /3` `F7 /3` | `NEG r/m8`, `NEG r/m16` |
| `F6 /4` `F7 /4` | `MUL r/m8` (AX = AL*src), `MUL r/m16` (DX:AX = AX*src) |
| `F6 /5` `F7 /5` | `IMUL r/m8`, `IMUL r/m16` |
| `F6 /6` `F7 /6` | `DIV r/m8` (AL=AX/src, AH=rem), `DIV r/m16` (AX=DX:AX/src, DX=rem) |
| `F6 /7` `F7 /7` | `IDIV r/m8`, `IDIV r/m16` |
| `40+r` | `INC r16` |
| `48+r` | `DEC r16` |
| `FE /0` `FF /0` | `INC r/m8`, `INC r/m16` |
| `FE /1` `FF /1` | `DEC r/m8`, `DEC r/m16` |
| `D0 /n` | `shift r/m8, 1` |
| `D1 /n` | `shift r/m16, 1` |
| `D2 /n` | `shift r/m8, CL` |
| `D3 /n` | `shift r/m16, CL` |

Shift extensions: `/0 ROL`, `/1 ROR`, `/2 RCL`, `/3 RCR`, `/4 SHL` (alias `SAL`), `/5 SHR`, `/7 SAR`. `/6` is undefined.

Division by zero or a quotient that does not fit kills the process (real 8086 raises `#DE`; here there is no handler).

### 3.3 Control flow

| Bytes | Mnemonic | Condition |
|---|---|---|
| `EB cb` | `JMP rel8` | |
| `E9 cw` | `JMP rel16` | |
| `FF /4` | `JMP r/m16` | absolute |
| `E8 cw` | `CALL rel16` | push IP of next instruction |
| `FF /2` | `CALL r/m16` | absolute |
| `C3` | `RET` | |
| `C2 iw` | `RET imm16` | pop, then SP += imm16 |
| `70 cb` | `JO` | OF=1 |
| `71 cb` | `JNO` | OF=0 |
| `72 cb` | `JB` / `JC` / `JNAE` | CF=1 |
| `73 cb` | `JAE` / `JNC` / `JNB` | CF=0 |
| `74 cb` | `JE` / `JZ` | ZF=1 |
| `75 cb` | `JNE` / `JNZ` | ZF=0 |
| `76 cb` | `JBE` / `JNA` | CF=1 or ZF=1 |
| `77 cb` | `JA` / `JNBE` | CF=0 and ZF=0 |
| `78 cb` | `JS` | SF=1 |
| `79 cb` | `JNS` | SF=0 |
| `7A cb` | `JP` / `JPE` | PF=1 |
| `7B cb` | `JNP` / `JPO` | PF=0 |
| `7C cb` | `JL` / `JNGE` | SF≠OF |
| `7D cb` | `JGE` / `JNL` | SF=OF |
| `7E cb` | `JLE` / `JNG` | ZF=1 or SF≠OF |
| `7F cb` | `JG` / `JNLE` | ZF=0 and SF=OF |
| `E0 cb` | `LOOPNE` / `LOOPNZ` | CX--; jump if CX≠0 and ZF=0 |
| `E1 cb` | `LOOPE` / `LOOPZ` | CX--; jump if CX≠0 and ZF=1 |
| `E2 cb` | `LOOP` | CX--; jump if CX≠0 |
| `E3 cb` | `JCXZ` | CX=0 |

There are no 16-bit conditional jumps on the 8086. The assembler emits `Jcc rel8` and reports an error "jump out of range" when the target is farther than -128..+127; the player uses the inverted-jump-plus-`JMP rel16` idiom. (No silent jump relaxation. It makes code size honest.)

### 3.4 String instructions

| Bytes | Mnemonic | Effect |
|---|---|---|
| `A4` | `MOVSB` | `[DI] = [SI]`; SI, DI += ±1 |
| `A5` | `MOVSW` | `[DI] = [SI]` (word); SI, DI += ±2 |
| `A6` | `CMPSB` | flags from `[SI] - [DI]`; SI, DI += ±1 |
| `A7` | `CMPSW` | |
| `AA` | `STOSB` | `[DI] = AL`; DI += ±1 |
| `AB` | `STOSW` | `[DI] = AX`; DI += ±2 |
| `AC` | `LODSB` | `AL = [SI]`; SI += ±1 |
| `AD` | `LODSW` | |
| `AE` | `SCASB` | flags from `AL - [DI]`; DI += ±1 |
| `AF` | `SCASW` | |
| `F3 A4..AD` | `REP` | repeat while CX≠0 (for MOVS/STOS/LODS) |
| `F3 A6/A7/AE/AF` | `REPE`/`REPZ` | repeat while CX≠0 and ZF=1 |
| `F2 A6/A7/AE/AF` | `REPNE`/`REPNZ` | repeat while CX≠0 and ZF=0 |
| `FC` | `CLD` | DF=0 (increment) |
| `FD` | `STD` | DF=1 (decrement) |

**Timing rule for REP.** A `REP`-prefixed instruction executes **one iteration per cycle**. After each iteration, if the repeat condition still holds, IP is left pointing at the prefix so the process re-executes it on its next turn. This is exactly how the 8086 handles interrupts mid-REP and it keeps `rep movsw` from being a free 64 KB copy. A bot being copied can therefore be bombed mid-copy.

### 3.5 Flags and misc

| Bytes | Mnemonic |
|---|---|
| `F8` | `CLC` |
| `F9` | `STC` |
| `F5` | `CMC` |
| `90` | `NOP` |

### 3.6 Process control (ASM Bots extensions)

| Bytes | Mnemonic | Effect |
|---|---|---|
| `00` | `DAT` (any second byte) | kill the executing process. Assembler emits `DAT` as `00 00` (2 bytes) so a bombed word reads as one DAT. `DAT imm8` emits `00 ib`. |
| `60 cb` | `SPL rel8` | spawn a child process at target; parent continues |
| `61 cw` | `SPL rel16` | same, 16-bit relative |
| `62 /0` | `SPL r/m16` | spawn at absolute address in r/m16 |
| `F4` | `HLT` | kill the executing process (intentional) |
| `CC` | `INT3` | kill the executing process; in the debugger it is a breakpoint instead |

`SPL` semantics: the child gets a **copy** of the parent's registers and flags at the moment of the split, with IP set to the target. The child is appended to the back of the bot's process queue. The parent's IP advances past the SPL. If the bot is at its process cap, SPL is a NOP (no kill, no child). Child and parent share the core; there is no per-process memory.

### 3.7 Everything else

Any opcode byte or ModR/M combination not listed above is **undefined** and kills the process. That includes `0F`, `26 2E 36 3E`, `27 2F 37 3F` (decimal adjust), `63..6F` except `60..62`, `9A` (far call), `9B` (WAIT), `C4 C5` (LES/LDS), `C8..CB`, `CD CE CF` (INT n, INTO, IRET), `D4..D7`, `D8..DF` (ESC), `E4..E7` (IN/OUT), `EA` (far jump), `EC..EF`, `F0 F1`, `FA FB` (CLI/STI), `FF /3 /5` (far), `FF /7`, and `F6 /1`, `F7 /1`.

## 4. Flags semantics

Standard 8086:

- `ADD/ADC/SUB/SBB/CMP/NEG`: CF, PF, AF, ZF, SF, OF all set.
- `INC/DEC`: all except CF.
- `AND/OR/XOR/TEST`: CF=0, OF=0, ZF SF PF set, AF undefined (reads 0).
- `MUL/IMUL`: CF=OF=1 if the upper half is nonzero (MUL) or not a sign extension (IMUL); ZF SF PF AF undefined (read 0).
- `DIV/IDIV`: all undefined (unchanged).
- Shifts: CF = last bit shifted out; OF defined only for count 1 (`SHL`: MSB xor CF; `SHR`: MSB of original; `SAR`: 0; `ROL/ROR`: MSB xor MSB-1 of result / MSB xor MSB-1); ZF SF PF set for SHL/SHR/SAR, unchanged for rotates. Counts are masked to 5 bits? No: the 8086 does **not** mask counts; a count of 40 shifts 40 times (result 0 and CF 0). We implement true 8086 behavior.
- `CMPS/SCAS`: as SUB.
- String moves/loads/stores: no flags.
- `LAHF/SAHF/PUSHF/POPF`: as documented.

PF is parity of the low 8 bits of the result (even parity → 1). It is implemented because real code uses `JP` idioms and because a decade-old project would have it.

## 5. Execution model

### 5.1 Processes

A **bot** is a loaded program. A **process** is (registers, flags, IP). Each bot owns a FIFO queue of processes (initially one). Per-bot cap: `maxProcesses` (default 64). A bot with an empty queue is **dead**.

### 5.2 Cycle

One **cycle**: for each living bot, in that cycle's turn order, pop the front process, execute exactly one instruction (one REP iteration counts as one instruction), and, if the process is still alive, push it to the back. Turn order rotates: cycle `c` starts with bot `(c mod N)` where N is the number of bots loaded, so no bot is systematically first.

This is pMARS fairness: a bot with 64 processes still gets one instruction per cycle, not 64. Splitting buys resilience, not speed.

### 5.3 Fetch, decode, execute

1. Read up to 6 bytes at IP (wrapping) and decode with the codec.
2. If decode yields UNDEFINED, DAT, HLT, or INT3: kill the process. Record a death event with reason `dat | hlt | int3 | undefined`.
3. Otherwise execute. Memory writes tag the byte's owner with the bot's index. Memory reads are untracked.
4. IP = address of next instruction, unless the instruction changed it (jumps, calls, ret, REP-in-progress).
5. If the instruction was DIV/IDIV with a zero divisor or overflowing quotient: kill with reason `div`.

Every instruction costs exactly one cycle. There is no instruction-timing table. Fairness beats realism here.

### 5.4 Memory ownership

Parallel to the 64 KB core is a 64 KB `owner` array (`Uint8Array`, 0 = nobody, 1..N = bot index + 1). Set on every write, including the initial load. Read by the renderer and by the "footprint" statistic. It has no effect on execution.

### 5.5 Battle

```
BattleConfig {
  coreSize: 65536          // fixed in v1
  maxCycles: 100000        // hill default 80000
  maxProcesses: 64         // per bot
  minSpacing: 1024         // bytes between bot images, no overlap allowed
  maxBotBytes: 512         // per bot, hill-configurable
  seed: uint32             // placement PRNG
}
```

Loading: for bots 0..N-1 in submission order, draw a base address from PCG32(seed) such that `[base, base+size)` neither overlaps nor comes within `minSpacing` of any placed bot, wrapping considered. Reject the seed (draw again, up to 1000 tries) rather than allow overlap; if N bots cannot fit, the battle is invalid. Write the bot's bytes at base with owner tags. Initial registers: `IP = base`, `SP = base` (the stack grows into the free space below the bot), `FLAGS = 0x0002`, all others 0.

Termination: after any cycle where at most one bot is alive, or when `cycle == maxCycles`. Result: list of survivors.

Scoring (pMARS multi-warrior): each survivor gets `floor((N*N - 1) / S)` points where S is the number of survivors; dead bots get 0. For N=2: sole survivor 3, both survive 1 each. A **round** is one battle. A **match** is K rounds with seeds `seed, seed+1, ..., seed+K-1` and the bot order rotated each round; match score is the sum.

### 5.6 Determinism contract

`simulate(bots, config) → Result` is a pure function. Implementations must not consult the clock, `Math.random`, or object iteration order. The engine exposes `step()` (one cycle), `run(n)`, `snapshot()` and `restore()` for the debugger, and an event stream (writes, executes, spawns, deaths) for the renderer. Two runs with identical inputs produce byte-identical event streams. A golden test enforces this across Bun, Node, Chrome, and a Cloudflare Worker.

## 6. Assembly language

NASM dialect, 16-bit, `bits 16` implied. Case-insensitive mnemonics and registers; case-sensitive labels.

```nasm
; Every line after ';' is a comment.
%name     "Dwarf"                 ; ASM Bots metadata directives use %name/%author/%strategy
%author   "A. K. Dewdney"
%strategy "Bombs every 4th word with DAT, walking the whole core."

        org 0                     ; optional; always 0. Bots are position independent (see 6.4).
start:  call .here                ; the base-register idiom
.here:  pop  bx
        sub  bx, .here            ; bx = this bot's base address
        lea  di, [bx+bomb]        ; di = absolute address of our bomb
.loop:  add  di, 4
        mov  word [di], 0         ; drop a DAT every 4 bytes, forever, wrapping the core
        jmp  .loop
bomb:   dat
```

### 6.1 Lexical

- Numbers: `123`, `0x1F`, `1Fh`, `0b1010`, `'A'` (char literal), `-7`.
- Identifiers: `[A-Za-z_.$?][A-Za-z0-9_.$?#@~]*`. `.name` is a local label scoped to the previous non-local label (NASM rule). `$` = address of the current line, `$$` = 0.
- Strings: `"..."` or `'...'` in `db` and metadata directives only.
- Operators in expressions: `+ - * / % << >> & | ^ ~ ( )`, unary `-`, with C precedence. Constant-folded at assembly time. Labels are allowed in expressions; `end - start` is the size idiom.

### 6.2 Directives

| Directive | Meaning |
|---|---|
| `%name "..."`, `%author "..."`, `%strategy "..."`, `%version "..."` | Bot metadata. `%name` required. |
| `org N` | Accepted, must be 0. |
| `bits 16` | Accepted, ignored. |
| `db`, `dw` | Data. Comma lists. `db` accepts strings. |
| `times N <instr or data>` | Repeat. |
| `resb N`, `resw N` | Reserve zeroed bytes (they are DAT). |
| `name equ expr` | Constant. |
| `%define NAME expr` | Text macro, single-line, no parameters. |
| `align N` | Pad with `00` (DAT) to N-byte boundary. |
| `dat`, `dat imm8` | Emits `00 00` or `00 ib`. |
| `spl target` | Chooses rel8 when in range, else rel16. |

Not supported (assembler error with a clear message): sections, `extern/global`, `%macro`, `%if`, `%include`, `incbin`, far pointers, segment registers, `[es:...]`.

### 6.3 Operand syntax

- Registers: `ax bx cx dx si di bp sp al ah bl bh cl ch dl dh`.
- Immediates: any constant expression.
- Memory: `[expr]` where expr is one of the eight 8086 base/index combinations plus an optional constant displacement, in any order: `[bx+si+4]`, `[4+si]`, `[bp]`, `[label]`, `[bx+label]`. `[label]` is `[disp16]`, absolute.
- Size: `byte`/`word` keyword required when neither operand is a register: `mov word [bx], 0`. Error otherwise ("operation size not specified").
- Jump targets: labels or expressions; `jmp short label` forces rel8, `jmp near label` forces rel16; default: rel8 if it fits, else rel16.

### 6.4 Position independence

The loader places a bot at a random base and **does not relocate**. `[label]` assembles to an absolute `[disp16]` computed from `org 0`, so it points at address `label` in the core, not at the bot's copy. This is deliberate and it is real. A bot that wants to reach its own data uses a base register:

```nasm
start:  call .here          ; push IP of .here
.here:  pop  bx             ; bx = absolute address of .here
        sub  bx, .here      ; bx = base address of this bot
        mov  ax, [bx+bomb]  ; position-independent data access
```

The docs teach this idiom on page one. The editor's linter warns on `[label]` without a base register ("absolute address; did you mean [bx+label]?"). `SPL rel`, `JMP rel`, `CALL rel` are relative and just work.

### 6.5 Assembler output

```
Assembled {
  name, author, strategy, version
  bytes: Uint8Array          // ≤ maxBotBytes
  entry: 0                   // always 0 in v1
  symbols: Map<string, number>
  listing: Line[]            // { address, bytes, source, lineNo } per source line, for the debugger
  sourceMap: Uint16Array     // byte offset → source line
  diagnostics: Diag[]        // { severity, line, col, len, message, code }
}
```

Errors are collected, not thrown. A bot with any error-severity diagnostic does not produce bytes.

## 7. Disassembly

`disassemble(bytes, base)` → `{ address, length, text, bytesHex, kind }[]`. Text is NASM syntax that re-assembles to the same bytes (round-trip test on every roster bot and on 100,000 random byte strings: `asm(dis(x)) == x` wherever `dis` yields a defined instruction). Undefined bytes render as `db 0xNN`. `00` renders as `dat`.

## 8. Reference test vectors

The codec test suite includes these exact encodings; if any fails, the codec is wrong, not the vector.

| Source | Bytes |
|---|---|
| `mov ax, 0x1234` | `B8 34 12` |
| `mov word [bx], 0` | `C7 07 00 00` |
| `mov byte [bx+si+4], 0x41` | `C6 40 04 41` |
| `mov ax, [0x0100]` | `A1 00 01` |
| `mov cx, [bp]` | `8B 4E 00` |
| `add bx, 4` | `83 C3 04` |
| `add bx, 0x100` | `81 C3 00 01` |
| `cmp al, 0` | `3C 00` |
| `xor ax, ax` | `31 C0` |
| `inc bx` | `43` |
| `dec word [di]` | `FF 0D` |
| `shl ax, 1` | `D1 E0` |
| `shr ax, cl` | `D3 E8` |
| `jmp short $` | `EB FE` |
| `jmp $ + 0x200` | `E9 FD 01` |
| `jnz $ - 10` | `75 F4` |
| `loop $ - 4` | `E2 FA` |
| `call $ + 3` | `E8 00 00` |
| `pop bx` | `5B` |
| `push word [bx]` | `FF 37` |
| `rep movsw` | `F3 A5` |
| `repne scasb` | `F2 AE` |
| `spl $ + 2` | `60 00` |
| `spl $ + 0x300` | `61 FD 02` |
| `spl bx` | `62 03` |
| `dat` | `00 00` |
| `hlt` | `F4` |
| `int3` | `CC` |
| `nop` | `90` |
| `lea si, [bx+di-2]` | `8D 71 FE` |

## 9. Documented divergences from the Intel 8086

1. **`0x00` is DAT, not `ADD r/m8, r8`.** The assembler rejects `add <mem8>, r8` with the message "this form encodes as 0x00 (DAT) and is unavailable; use `add <mem8>, imm8` or a word operation." Register-register byte ADD uses `02 /r`.
2. **`0x60`, `0x61`, `0x62` are SPL.** On a real 8086 these are undefined (they became PUSHA/POPA/BOUND on the 80186).
3. **No segments, no interrupts, no I/O, no timing.** Every instruction is one cycle. `HLT`, `INT3`, and undefined opcodes kill instead of trapping. `PUSH SP` uses the original 8086 semantics (pre-decrement value).

Everything else that is implemented behaves exactly like an 8086, including the un-masked shift count and the REP-interruptibility.

## 10. Versioning

`x16c v1`. Battles, replays, and hill results record the ISA version. Any semantic change (even a flag fix) is `v2` with a changelog entry and, if needed, a re-run of hill standings.
