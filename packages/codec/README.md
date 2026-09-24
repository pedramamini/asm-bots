# @asmbots/codec

The x16c v1 instruction codec. One opcode table (`TABLE` in `src/table.ts`) drives the decoder, the encoder, the formatter, and the length oracle. The assembler, disassembler, engine, and debugger import this package and hold no opcode knowledge of their own. Zero runtime dependencies. The contract is [ISA_SPEC](../../docs/ISA_SPEC.md) §2, §3, §8, and §9.

## API

| Export | Does |
|---|---|
| `decode(read, addr)` | Decodes one instruction and returns a `Decoded`. Reads at most 6 bytes through `read`. |
| `decodeInto(read, addr, out)` | The engine's fetch stage. Writes into `out` and allocates nothing. Returns the length, or `DECODE_UNDEFINED`, `DECODE_DAT`, `DECODE_HLT`, `DECODE_INT3` (-1..-4). |
| `instructionLength(read, addr)` | The length `decode` gives: 1..6, with 1 for an undefined byte. |
| `encode(input)` | A `Uint8Array`, or an `EncodeError` with a `code`, the ISA message, and the index of the operand at fault. It returns errors and never throws. |
| `format(x, { upper, hexStyle, base })` | NASM text that the assembler reads back to the same bytes. Where the encoder prefers a twin encoding (`FF C3` and `43` are both `inc bx`), the text gives the twin. |
| `TABLE`, `MNEMONICS`, `ALIASES`, `PREFIX_BYTE`, `PREFIX_ALIASES` | The table and its spellings. Canonical mnemonics are ndisasm's (`jz`, `jc`, `shl`); the other ISA spellings are aliases. |

`read(addr)` returns the byte at `addr`. The decoder asks for `addr`..`addr + 5` without wrapping; the engine passes a reader that wraps at 64 KB.

## The model

`Instr = { mnemonic, operands, prefix?, length }`, where `length` includes the prefix. `Decoded` is one of three shapes:

| `Decoded` | Meaning | `length` |
|---|---|---|
| `{ ok: true, instr }` | An instruction that executes | 1..6 |
| `{ ok: false, reason: 'dat' \| 'hlt' \| 'int3', instr }` | A table row that kills (ISA §3.6). `instr` is for display: `dat 0x41`. | 2, 1, 1 |
| `{ ok: false, reason: 'undefined', byte }` | Any other byte (ISA §3.7). The disassembler prints `db 0xNN` and resyncs at the next byte. | 1 |

| Operand | Fields | Conventions |
|---|---|---|
| `reg16`, `reg8` | `reg` | x86 register codes 0..7 (`REG16_NAMES`, `REG8_NAMES`). The CL shift count is `reg8` 1. |
| `imm` | `value`, `size`, `signed` | The raw unsigned field, except the sign-extended imm8 of `83 /n`: `signed: true`, -128..127. The implicit shift count is `imm` 1. |
| `mem` | `base`, `index`, `disp`, `dispSize`, `size` | `dispSize` is the field width: 0, 8, or 16. `disp` is signed with a base or index, and an unsigned address for a bare `[disp16]`. `size` is the data size; `lea` has none. |
| `rel` | `target`, `size` | Relative to the start of the instruction (`$ + target`), so a decoded instruction does not depend on its address. The encoded displacement is `target - length`. |
| `moffs` | `addr`, `size` | The direct address of `A0..A3`. |

Encoder input (`InstrInput`) takes the same operands with optional sizes. A size left out is the encoder's choice: the shortest form (`AL`/`AX` short forms, `83 /n`, `+r` opcodes, `A0..A3`, `90+r`, rel8), then operands in the order given, then the smaller immediate, then table order, as NASM chooses. A size given pins the form. Every decoded `Instr` is a valid input, and it encodes to bytes that decode to it again. The one exception is `xchg r16, ax`, which comes back as `xchg ax, r16` (`90+r`).

`decodeInto` reuses the operand objects of each `out` on every call. Read them before the next call, and do not change them.

## Divergences

**From the 8086** (ISA §9). These are deliberate.

| Bytes | x16c v1 | 8086 or later |
|---|---|---|
| `00 ib` | `dat`, 2 bytes, kills | `ADD r/m8, r8`. The encoder refuses `add <mem8>, r8` and encodes `add r8, r8` as `02 /r`. |
| `60 cb`, `61 cw`, `62 /0` | `spl rel8`, `spl rel16`, `spl r/m16` | 80186 `PUSHA`, `POPA`, `BOUND` |
| `F4`, `CC`, undefined bytes | Kill the process | Halt, trap |

**From NASM.** The encoder's bytes match `nasm -f bin` except here:

- `add r8, r8` is `02 /r`, since NASM's `00 /r` is DAT.
- `xchg r, r` puts the first operand in `rm`, so decoding gives the operands back in order. NASM puts it in `reg`. `xchg ax, ax` is `87 C0`, since `90` is `nop`.
- `format` writes `mov` between AL or AX and a ModR/M bare address as `mov ax, [word 0x0100]` (`8B 06`). NASM has no spelling for that form and emits `A0..A3`.
- A memory operand without a size is an error when byte and word forms both fit (`inc [bx]`, ISA §6.3). NASM picks byte.
- With `base`, `format` writes absolute targets (`jc 0x0023`). NASM makes a long jump of a conditional jump to a bare number; `$$ + 0x0023` gives the rel8 bytes. Without `base`, `format` writes `$ + N`, which NASM assembles as we do.

**From ndisasm.** `test/ndisasm.test.ts` allows exactly the ISA §9 rows: `00 00` as `add [bx+si],al`, `60` as `pusha`, `61` as `popa`, and `62 /0` as `bound ax, m` or, for a register, `db 0x62`. Spelling differences (`short`, `byte +0x4`, `0xffffffffffffffff`, `xchg` operand order) are normalization rules, listed in the test.

**From the spec text.** ISA §8 lists `spl bx` as `62 03`. By §2.2, `62 03` is `spl word [bp+di]`, and `spl bx` is `62 C3`. The codec follows §2.2 and the tests use `62 C3`. ndisasm agrees: it reads `62 03` as `bound ax,[bp+di]`.

## Adding an instruction

1. Change `docs/ISA_SPEC.md` first. The ISA is frozen, so a new instruction is x16c v2 (ISA §10).
2. Add a row to `TABLE`, in ISA order: `row(opcode, mnemonic, operands, { ext, aliases, prefixes, signExtend })`. A `+r` form is `plusR(...)`. A new mnemonic also goes into the `Mnemonic` union in `src/types.ts`.
3. Add a test vector, source and bytes, to the ISA §8 tables in `test/decode.test.ts`, `test/encode.test.ts`, `test/format.test.ts`, and `test/ndisasm.test.ts`. Mirror the spec change in `test/table.test.ts` (`DEFINED`, `GROUPS`, `ISA_SPELLINGS`, `SYNONYMS`, `UNDEFINED`). If the row reads differently on an 8086, add a `DIVERGENCES` entry to `test/ndisasm.test.ts`.
4. A new mnemonic needs a `summary` and an `example` in `docs/notes.json`, and a family and its flags in `scripts/gen-opcode-docs.ts` (`FAMILY_OF`, `FLAGS`). Then `bun run opcodes` writes the repo's `docs/opcodes.json`, the reference the editor's hover cards and completions read. `scripts/gen-opcode-docs.test.ts` fails until the file is current, and it runs every table row in the engine to hold `FLAGS` to what the engine does.

Nothing else in the codec changes. The decoder's dispatch array, the encoder's forms, the formatter's size pins, and the length oracle are built from `TABLE` when the module loads. The per-row round trip, the format sweep, the fuzz test, and the ndisasm cross-check cover the new row without edits. The exception is a new operand template (`OperandTemplate`). It needs a case in `fill` (`src/decode.ts`), in `fits` and `trailing` (`src/encode.ts`), and, for a trailing field, in `TRAILING_SIZE` (`src/table.ts`). The typecheck flags `fill` and `fits`.

## Tests and benchmark

| Command | Runs |
|---|---|
| `bun test` | The table, the decoder, the encoder, the formatter, the length oracle, 100,000 seeded random strings (`test/fuzz.test.ts`), and the ndisasm cross-check. The cross-check is skipped when `ndisasm` is not installed (`brew install nasm`; CI installs it). It reads the output of ndisasm 2.16 (Ubuntu, CI) and 3.02 (Homebrew). |
| `bun run bench` | Decodes a 64 KB random core end to end, 100 times, and prints decodes per second. It asserts no floor. |

On 2026-09-23 (Apple M5 Max, Bun 1.3.6), `bun run bench` measured 73 M decodes/s for `decodeInto` and 36 M decodes/s for `decode`.

The text round trip, `assemble(format(x))` equals `encode(x)`, needs the assembler, so `@asmbots/asm` tests it (`packages/asm/test/roundtrip.test.ts`). The codec's half, `encode(spell(x))` equals `encode(x)`, is in `test/fuzz.test.ts`.
