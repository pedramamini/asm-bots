---
name: asm-bots
description: Write, test, and submit Core War bots for ASM Bots (asmbots.io), written in x16c, a real 16-bit 8086 subset. Use when asked to write, debug, improve, or benchmark an ASM Bots or x16c bot, to fight bots with the asmbots CLI, or to push a bot and submit it to a hill on asmbots.io.
---

# ASM Bots

ASM Bots is Core War in real 8086 machine code ("x16c v1"). A bot is at most 512 bytes of
NASM-syntax assembly. The loader places every bot at a random address in one shared 64 KB core
that starts zeroed. Each cycle every living bot runs one instruction. A process that runs a
zero byte (DAT) dies, a bot with no process left is dead, and the last bot alive wins the round.

This file is part of the skill folder `asm-bots/` (download: https://asmbots.io/skill/asm-bots.zip).
Every path below is relative to that folder. Run the commands from it. `bin/asmbots.js` needs
Node.js. The same docs are online at https://asmbots.io/llms.txt.

## The loop

1. **Read the rules first.** In `references/`, read in this order:
   `machine-memory.md`, `machine-registers.md`, `machine-processes.md`, `machine-death.md`,
   `machine-placement.md`, `machine-scoring.md`, `machine-position-independence.md`.
   Then the strategy guide: `strategy-imps.md`, `strategy-dwarves.md`, `strategy-stones.md`,
   `strategy-papers.md`, `strategy-scanners.md`, `strategy-vampires.md`, `strategy-imp-gates.md`,
   `strategy-stack-tricks.md`, `strategy-hygiene.md`, `strategy-hill-meta.md`.
   Look up any instruction in `reference-*.md` (encoding, flags, and bytes of every form).
2. **Write the bot** in a `.asm` file. Start from the closest example in `examples/`. Keep:
   - the directives: `%name "..."` (required), `%author "..."`, `%strategy "one line"`;
   - the base idiom, because the loader does not relocate and `[label]` is an absolute address:
     ```asm
     start:  call    .here
     .here:  pop     bx
             sub     bx, .here           ; bx = this bot's base address
             lea     di, [bx+bomb]       ; reach your own bytes as [bx+label]
     ```
   - the size cap: 512 bytes (256 on the `tiny` hill). Smaller bots are harder to hit.
3. **Assemble** and read every diagnostic (`file:line:col: severity: message [code]`):
   ```sh
   node bin/asmbots.js asm bot.asm --listing --max-bytes 512
   ```
   `--listing` prints each line's address and bytes. Exit code 2 means the source has errors.
4. **Fight** every example and iterate until the bot wins more than it loses:
   ```sh
   node bin/asmbots.js tourney roundrobin bot.asm examples/imp.asm --rounds 20
   node bin/asmbots.js tourney roundrobin bot.asm examples/*.asm --rounds 10
   node bin/asmbots.js fight bot.asm examples/dwarf.asm --seed 1
   node bin/asmbots.js fight bot.asm examples/dwarf.asm --seed 1 --trace --trace-bot "My Bot"
   ```
   `tourney roundrobin` plays matches (the rounds rotate the order) and prints the standings by
   points: in a duel a round is 3 points to the sole survivor, 1 each for a tie. `fight` plays one
   round per seed and prints the placement, the survivors, and each bot's death cycle and reason
   (`dat`, `undefined`, `hlt`, `int3`, `div`). `--trace` prints every instruction with the
   registers. `fight --rounds K` prints only the last round: use `tourney` to score. A roster bot
   also works by name: `roster:dwarf`. Hills play 80,000 cycles a round: add `--cycles 80000`
   to `fight` to match.
5. **Get an API token.** Sign in with GitHub at https://asmbots.io, open settings, then
   `api tokens`, and create one. Then either run `node bin/asmbots.js login` and paste it
   (or `login --token <token>`), or set the environment variable `ASMBOTS_TOKEN`.
   `node bin/asmbots.js whoami` checks it. `ASMBOTS_SERVER` (or `login --server <url>`) points
   the CLI at another server.
6. **Push the bot** to your account (a new version when you have a bot of that name):
   ```sh
   node bin/asmbots.js push bot.asm [--name "My Bot"] [--visibility public|unlisted|private]
   ```
7. **Submit it to a hill** (`submit` pushes first, so step 6 is optional) and wait for the
   result, then read the hills:
   ```sh
   node bin/asmbots.js submit main bot.asm --wait
   node bin/asmbots.js hills
   ```
   The hills: `main` (32 entries, duels of 10 rounds, 80,000 cycles, up to 512 bytes), `tiny`
   (16 entries, 50,000 cycles, up to 256 bytes). A challenger stays only if it scores more than
   the lowest entry. One submission runs on a hill at a time, five an hour. `logout` forgets the
   token.

## x16c cheat sheet

From `references/` and the ISA spec; check a detail there before relying on it.

- **Core:** 65,536 bytes, `0x0000`..`0xFFFF`, one flat ring: addresses and values wrap, no
  segments. It starts zeroed, and `0x00` is DAT, so empty core kills whatever runs into it.
- **Registers:** `ax bx cx dx si di bp sp` (16-bit), `al ah bl bh cl ch dl dh` (halves), `ip`,
  FLAGS (`O D S Z A P C` are used). Only `bx bp si di` address memory: `[bx+si+4]`, `[di]`,
  `[bp+2]`, `[bx+label]`. A process starts with `ip` and `sp` at the bot's base, FLAGS `0x0002`,
  every other register 0: `di` is 0 until you set it, so a bomb through it hits address 0.
- **Cycles:** every instruction is one cycle, `div` and `rep movsw` alike. Each cycle every living
  bot runs one instruction of the process at the front of its queue, and that process goes to the
  back. The bot order rotates each cycle. `rep` runs one iteration a cycle, so a copy can be
  bombed mid-way.
- **Processes:** `spl target` starts a child with a copy of the registers at `target`; it queues
  just ahead of its parent. Up to 64 processes a bot; at the cap `spl` does nothing. More
  processes are not faster, only harder to kill.
- **Death:** running `00` (DAT), `F4` (`hlt`), `CC` (`int3`), an undefined opcode (`0F`, segment
  prefixes, `rep` before a non-string instruction, far jumps, ...), or a failing `div`/`idiv`.
  Writing, reading, and jumping anywhere never kill.
- **Placement:** a random base from the round's seed, at least 1,024 bytes from every other bot.
  The stack starts at your base and grows down into the free core below you.
- **Scoring (pMARS):** with N bots and S survivors, each survivor scores `floor((N*N - 1) / S)`,
  the dead 0. A round ends when one bot or none is alive, or at the cycle cap (100,000 by default,
  80,000 on the hills). A match is K rounds with seeds `seed` to `seed + K - 1`, summed.
- **Jumps:** conditional jumps and `loop` are rel8 only (-128..127 bytes); the assembler reports
  "jump out of range" rather than growing them. Use the inverted jump plus `jmp` for far targets.
- **Assembler:** NASM syntax; `equ`, `times`, `db`/`dw`, `resb`/`resw` (zero bytes, so DAT),
  `align` (pads with `00`), `$`, `.local` labels, `end - start` for a size. No macros, sections,
  or segment registers. `add byte [mem], reg` is refused: it would encode as `00`.

| instruction | bytes | encoding | use |
|---|---|---|---|
| `dat` | 2 | `00 00` | a bomb word; `dat imm8` is `00 ib` |
| `nop` | 1 | `90` | |
| `mov word [di], 0` | 4 | `C7 05 00 00` | the dwarf's bomb |
| `mov [di], ax` | 2 | `89 05` | the same bomb with `ax` = 0 |
| `xor ax, ax` | 2 | `31 C0` | `ax` = 0 |
| `mov cx, 256` | 3 | `B9 00 01` | any `mov r16, imm16` |
| `add di, 4` / `sub di, 4` | 3 | `83 C7 04` / `83 EF 04` | imm8 sign-extended; imm16 is 4 bytes |
| `inc di` / `dec cx` | 1 | `47` / `49` | |
| `lea di, [bx+12]` | 3 | `8D 7F 0C` | 4 bytes with a disp16 |
| `stosw` / `stosb` | 1 | `AB` / `AA` | `[di] = ax` (al), `di` += 2 (1), or -= after `std` |
| `movsw` / `movsb` | 1 | `A5` / `A4` | `[di] = [si]`, both step: the imp |
| `lodsw` | 1 | `AD` | `ax = [si]` |
| `rep movsw` / `rep stosw` | 2 | `F3 A5` / `F3 AB` | `cx` times, one word a cycle |
| `repe scasb` | 2 | `F3 AE` | with `al` = 0: runs over zero bytes, stops on the first other one |
| `push ax` / `pop bx` | 1 | `50` / `5B` | `sp` -= 2, then `[sp]` = `ax`: with `ax` = 0, a bomb in one byte |
| `call label` / `ret` | 3 / 1 | `E8 cw` / `C3` | |
| `jmp short` / `jmp near` | 2 / 3 | `EB cb` / `E9 cw` | |
| `jz`, `jnz`, `jc`, ... | 2 | `74 cb`, `75 cb`, `72 cb` | rel8 only |
| `loop label` | 2 | `E2 cb` | `cx` -= 1, jump while `cx` is not 0 |
| `jmp bx` | 2 | `FF E3` | absolute: a jmp through a register |
| `spl label` | 2 or 3 | `60 cb` / `61 cw` | rel8 when in range |
| `spl bx` | 2 | `62 C3` | absolute address in a register |
| `hlt` / `int3` | 1 | `F4` / `CC` | kill the process that runs them |
| `cld` / `std` | 1 | `FC` / `FD` | string instructions walk up / down |

## Strategy families

One line each; `references/strategy-*.md` has the math and the matchups.

- **Imp** (`examples/imp.asm`, `examples/imp-ring.asm`): `movsw` copies the running word one
  word ahead; hard to kill, seldom kills: imps tie. Rings of imps survive a hit.
- **Dwarf / bomber** (`examples/dwarf.asm`, `examples/dwarf-wide.asm`, `examples/decoy.asm`):
  drop a DAT word every few bytes across the core. The stride decides what a lap can miss.
- **Stone** (`examples/stone.asm`): several bombers in one bot as processes, unrolled loops, a decoy.
- **Paper / silk** (`examples/paper.asm`, `examples/silk.asm`): copy yourself around the core with
  `rep movsw` and `spl` into each copy; silk starts the copy first and writes over its pad.
- **Scanner** (`examples/scanner.asm`, `examples/hybrid.asm`): `repe scasb` with `al` = 0 for
  non-zero bytes, then carpet-bomb around each hit; the hybrid turns to paper when bombed.
- **Vampire** (`examples/vampire.asm`): bite code with `jmp` fangs built at run time, and hold
  each bitten process in a pit: a held process still takes its bot's turns.
- **Imp gate** (`examples/gate.asm`): keep changing one word near your body so an imp that walks
  through it dies.

Matchups from the guide: a stone usually reaches a scanner first, and a decoy's bomber beats it
too; a vampire beats bombers and scanners; paper beats stones and vampires (its copies are
everywhere); imps seldom kill, so they tie. Your hill score depends on the whole field: read
`strategy-hill-meta.md` before you submit.

## Examples

Every roster bot, with the strategy its file's header comment explains line by line:

{{examples}}

## References

The docs pages, one file each, by section. Links between them are relative file names.

{{references}}

## Tips

- Test against every example and many seeds: placement is random, and a bot that beats one
  family often loses to another.
- Keep the body small: every non-zero byte is something a scanner can find and a bomb can hit.
- To watch a round, paste the bot into https://asmbots.io/editor (a debugger) or the arena.
