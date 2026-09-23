# Roster

The bots that ship with ASM Bots. Each bot is one x16c file in this folder (a test bot is in `test/`) and one row in `src/roster.ts`. `test/roster.test.ts` holds every file to the [house style](#house-style).

## Families

Six families come from classic Core War. The bots translate the ideas, not the Redcode: a Redcode `DAT` is a `00` byte here, `SPL` is `spl`, and the core is 64 KB of bytes that start at zero, so a process that runs into empty core dies.

| Family | Core War ancestor | The idea in x16c |
|---|---|---|
| `imp` | Imp (A. K. Dewdney, 1984), imp rings | A self-copier: `movsw` copies the running word one step ahead and the process runs into the copy. It is hard to kill and seldom kills, so imps tie. |
| `dwarf` | Dwarf (A. K. Dewdney, 1984) | A bomber: it writes DAT (`mov word [di], 0`) at a fixed stride as it walks the core. Each lap ends just past the bot, so the bombs never land on it. |
| `stone` | Stones | A dwarf that uses `spl` to run several bombers with different strides, often with an imp as a decoy. |
| `paper` | Paper, Silk | A replicator: `rep movsw` copies the bot, `spl` starts the copy, and each copy copies again. Bombs cannot kill the copies as fast as they appear. |
| `scanner` | Scanners | It looks for non-zero bytes with `repe scasb` (which repeats while the byte is zero) and carpet-bombs what it finds with `rep stosw`, skipping its own body. |
| `vampire` | Vampires | It writes `jmp` fangs over enemy code. A process that runs a fang jumps into a pit, where it does work that cannot hurt anyone. |
| `painter` | None: ASM Bots only | Showcase bots that paint patterns over the core, such as an LCG scatter or a square spiral. They make the arena worth watching. |
| `test` | None | Small bots that each pin down one engine behavior, such as `halt` (dies at once) and `spin` (lives to the cycle cap). They are not fighters. |

The classic families form a triangle: a stone beats a scanner (the scanner is big and slow), a scanner beats paper (a scan finds the copies), and paper beats a stone (copies appear faster than bombs land). Imps tie with most bots, and an imp gate stops imps.

## Tiers

| Tier | Holds |
|---|---|
| `showcase` | The headline fighters and painters. The golden matchups play them against each other. |
| `solid` | Real fighters that fill out the roster. |
| `test` | The test bots: family `test`, file `roster/test/<slug>.asm`. Every other bot is `roster/<slug>.asm`. |

## House style

A roster bot reads like this one:

```nasm
; Sketch drops one lap of DAT bombs, 8 bytes apart, starting just past its own end.
; The lap stops 256 bytes short of home and the bot then spins in place, so it never bombs itself.
; It shows the house style and is not a roster bot.

%name     "Sketch"
%author   "ASM Bots"
%strategy "One lap of DAT bombs, 8 bytes apart, then spin"

STRIDE  equ     8                       ; bytes between bombs
LAP     equ     0xFF00 / STRIDE         ; bombs in a lap that stops 256 bytes short

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        lea     di, [bx+end]
        mov     cx, [bx+count]          ; own data, read through bx

; Bomb: one DAT per turn until the lap is done, then spin.
bomb:   add     di, STRIDE
        mov     word [di], 0
        loop    bomb
        jmp     $

; Data, after the code, where no instruction falls into it.
count:  dw      LAP
end:
```

1. **Header comment.** The file starts with `;` lines: three sentences on the tactic, which say what the bot does, how, and why that works. A fighter adds the record from its acceptance test as one more line, in this form: `; vs imp.asm, seeds 1..20: 14 W / 6 T / 0 L`.
2. **Metadata.** `%name`, `%author`, and `%strategy`, in that order, after one blank line. `%name` and `%author` are the `name` and `author` of the roster entry. `%strategy` is one short line for the arena.
3. **Constants.** Each tuning number (a stride, an offset, a count) is an `equ` in capitals before `start:`, with a comment.
4. **The base idiom.** The loader puts a bot at a random address and does not relocate it (ISA §6.4). So `start:` begins with `call .here`, `pop bx`, and `sub bx, .here`, and then `bx` holds the base address. The bot gets to its own data only through `[bx+label]`: `[label]` is a fixed address in the core, and the linter warns on it. `jmp`, `call`, `loop`, and `spl` are relative and need no base. A bot that needs `bx` for other work keeps the base in another register, and a comment says which.
5. **Labeled sections.** One global label per phase (`start` for setup, then `bomb`, `scan`, `copy`, and so on), with a comment line above it, and `.local` labels inside a phase. Data and bomb templates go after the code, behind a jump, where no instruction falls into them.
6. **Formatter-clean.** The file is exactly what `formatSource` gives for it: labels in column 0, mnemonics in 8, operands in 16, and comments in 40.
7. **Lint-clean.** `lint` gives no warnings, except on a line with an allow comment, `; lint: allow <code>: <reason>`. The comment names the code of a warning on its own line and says why the bot needs it. An allow comment that allows no warning fails the test. From `test/halt.asm`:

   ```text
   start:  hlt                             ; lint: allow hlt-in-code: dying at once is the whole bot
   ```

8. **Small.** At most 512 bytes (`MAX_BOT_BYTES`).

`test/roster.test.ts` checks each rule that a machine can check: the header comment of three or more sentences, the metadata against the entry, the formatter, the linter, the size, and zero assembler errors. It checks the Sketch bot above the same way. `test/fighters.test.ts` fights each bot with the helper in `test/fight.ts` (hill rules, 80,000 cycles, the bot order swapped every other seed) and checks that each record line in a header is the record it gets.

## Loading

`src/roster.ts` imports each file as text (`import imp from '../roster/imp.asm' with { type: 'text' }`), so the bots are in the bundle and the package runs in browsers and Workers, with no file system. Bun reads these imports as they are; the web and Worker builds need a text loader for `.asm` files. A new bot is a file here, an import, and a row in `ROWS`.
