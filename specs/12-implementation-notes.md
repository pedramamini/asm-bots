# 12 — Implementation Notes (do/don't list)

This is the "things I learned the hard way" doc. The reference prototype
works, but it's accumulated workarounds. Future implementers — read
this *first*, not last.

## DO

### DO use a single shared memory

One `Uint8Array` of `MEMORY_SIZE` bytes. Don't give each bot its own
sandbox — the whole point of the game is that bots write into each
other's code.

### DO normalize every memory access

```ts
function normalize(addr: number) {
  return ((addr % SIZE) + SIZE) % SIZE
}
```

The `+ SIZE` and double-mod handle negatives. Apply on **read AND
write**, on **byte AND word** ops, on **PC AND SP**.

### DO track ownership at the cell level

Per-cell `Uint16Array` of process IDs. Update on every write. The
visualization can't function without it.

### DO use round-robin scheduling

A small quantum (5 cycles) and round-robin produces the interleaved
execution that makes battles legible. Pure FIFO or pure priority
produces "Bot A runs forever, then Bot B" which is dull.

### DO validate parser errors before generating code

```ts
const r = parser.parse(src)
if (r.errors.length) throw new Error(r.errors[0].message)
```

The codegen will silently produce nonsense if it sees a half-broken
token stream.

### DO emit absolute jump targets after relocation

Do the address arithmetic in the assembler. Don't put fragile heuristics
("if target < 0x100, treat as relative") in the executor.

### DO randomize bot start positions

Random base address (with a sane region cap) is critical. If bots always
start at the same place, the game is deterministic and dull.

### DO start each process at PC = entry point

But also support per-reset randomization within the bot's code segment.
The "give each process a slightly different starting PC on reset" trick
makes re-runs feel different.

### DO treat unknown opcodes as NOPs

Don't terminate on an unknown byte. A scanner walking enemy code will
constantly hit garbage; killing it on the first surprise byte is
gameplay-destroying.

### DO terminate on DAT execution

This is the classic Core War bomb. Sets the gameplay loop: scatter DATs
into opponents' code, hope they execute one.

### DO terminate on HALT

Authors who deliberately halt a process expect it to die. (They're
usually wrong about what they should do, but respect their wishes.)

### DO log per-cycle for debugging, but throttle for the network

The prototype emits a console.log per executed instruction. Fine for
local debugging; *will* tank a remote logger. Throttle to "interesting"
events on the wire.

### DO use a fresh BattleSystem per battle

Don't try to multiplex one engine across multiple battles. State
isolation is much easier this way.

## DON'T

### DON'T mix process scheduling between battles

Each battle gets its own ProcessManager with its own ID counter. Don't
share PIDs across battles or you'll get dashboard cross-contamination.

### DON'T make CMP set a flags register if your bots use r0

The shipped bots all do `cmp r0, 10` then `jl/jz/jnz` based on the value
in r0 (because the prototype writes the comparison result *to r0*).
Switching to a real flags register breaks every bot.

If you really want flags, use a *new* mnemonic (`tst`?) and leave `cmp`
behaving the way the bots expect.

### DON'T fail loudly on memory protection violations

Log them, drop the write, continue. A bot scanning protected memory
shouldn't die.

### DON'T trust the prototype's pass-1 sizing

It's wrong (every instruction is sized as 1 byte instead of 1–3). The
relocation step compensates because *all* offsets are wrong by the same
factor. Fix it in the rebuild — make symbol values mean real byte
addresses.

### DON'T write 16-bit values via a single MOV

The prototype's MOV writes one byte at a time. Bots that try `mov [bx],
0xFFFF` only get the low byte. If you want a 16-bit store, add a new
opcode (`STORE16` / `MOV16`).

### DON'T re-`encode` after `relocate`

The symbol table is mutated during relocation. Calling `encode` again
re-resolves symbols against post-relocation values, double-shifting
addresses. Encode once, layout once, relocate once.

### DON'T `layout()` twice

See above. The prototype does it; it's a bug. Encode → layout →
relocate is the one true order.

### DON'T let SPL chains exceed the process cap silently in a way
that breaks the scheduler

Hitting the cap should NOT terminate the parent or generate exceptions.
Just no-op the SPL. Vampire bots will SPL constantly; the cap is the
load-bearing safety valve.

### DON'T forget to clear the "current process" after loading

Memory writes during initial code load attribute ownership to whichever
pid is "current." If you forget to clear, post-load writes from
unrelated bookkeeping get tagged to the last-loaded bot. Always:

```
memory.setCurrentProcess(pid)
// ... write segment bytes ...
memory.setCurrentProcess(null)
```

### DON'T render every cell every frame at 60 fps

64 K cells × 60 fps = 3.9 M cell paints/second. Works, but wasteful.
Track dirty cells (changed memory or recent access) and only repaint
those, plus the always-changing PC outlines.

### DON'T conflate "score" with "won"

Score = cycles executed. The winner is determined by *who has live
processes at the end* (or the largest memory footprint as a tiebreaker).
A bot can score very high and still lose. Don't display score as a
ranking.

## Subtle gotchas

### Stack pointer

Initial SP is `0xFFFF`. Push subtracts 2 first, then writes. Pop reads,
then adds 2. For two bots with default SP, their stacks point at the
same place — they'll trample each other's stacks on the first push.

For competitive play this is fine (it's just another vector of attack).
But the rebuild might want to randomize initial SP per process, or push
each bot's initial SP to the high byte of *their own code segment + N*,
to avoid the immediate clash.

### `defense_start` predefined symbol

The parser pre-loads `defense_start = 0x300` because the original
`fortress.asm` referenced it before defining it. The bot now also
defines it via `equ`, so the predefine is redundant but harmless.
Drop it if you don't care about backwards compat.

### `code_size equ $ - start`

A common idiom in the bots. Pass-1 must support this: when the parser
sees `code_size equ $ - start`, it should evaluate `$` as the current
address and `start` from the symbol table, computing the difference.
The prototype has a special-case branch for this exact pattern; the
rebuild can either special-case it or implement a real expression
parser.

### `word` modifier

Bots like `fortress` use `mov word [bx], trap`. The `word` is parsed
as a no-op modifier. Honor it (no error) but don't try to give it
semantics — there is no "byte vs word" distinction in this engine.

### x86-style register aliases

`ax`, `bx`, `cx`, `dx`, `si`, `di` all map to `r0..r3`. Specifically:
- `ax = r0`
- `bx = r1`, `si = r1`
- `cx = r2`, `di = r2`
- `dx = r3`

Several bots mix the two naming styles in the same program. Don't try
to disambiguate; treat them as identical.

### `start` label is the entry point

By convention. Bots that don't have a `start:` label use the byte at
the segment's base address. The loader explicitly overwrites
`generatedCode.entryPoint = generatedCode.segments[0].start` after
relocation, ignoring whatever the symbol table says. This is a
prototype workaround for relocate-then-re-derive-entry-point bugs;
fix in the rebuild by making `relocate` correctly update the entry
point.

### Memory size is a config value

64 KB is the default but smaller (8 KB, 16 KB) makes for faster, more
chaotic battles. The CLI's `runBattle.ts` uses this. The frontend's
canvas should adapt: cell-size × column-count × row-count = total
memory, with row count derived from total / 256.

## Recommended starting stack

If you're building this fresh in 2026:

- **Backend:** Rust (axum + tokio + tungstenite) for performance and
  type-safety, OR TypeScript (Bun + ws) for fast iteration.
- **Frontend:** plain Canvas + ES modules, or Solid/Svelte if you want
  reactivity. Avoid React for the canvas — too slow.
- **Storage:** SQLite via `better-sqlite3` or `rusqlite`.
- **Tests:** start with ten bot-vs-bot integration tests (one per
  shipped bot, plus matchup tests) — they catch regressions instantly.
