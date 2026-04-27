# 11 — Bot Catalog

This is the canonical list of bots that shipped with the prior prototype.
The actual `.asm` source files are in [`bots/`](bots/) — copied verbatim
from the prototype, ready for a fresh implementation to consume.

Each bot is annotated with: **purpose**, **strategy**, **expected
behavior**, and **known issues** (places the prototype's quirks let it
"work" in surprising ways).

The bots fall into three buckets:

- **Combat bots** — playable, intentional strategies (fortress, hunter,
  vampire).
- **Painters** — visualization showcases (RandomWriter1, RandomWriter2).
- **Test bots** — minimal programs to exercise specific opcodes/features.

## Combat bots

### `fortress.asm` — defensive perimeter

> Establishes a defensive structure of "trap" cells at fixed offsets,
> then patrols, attacking anything that isn't its trap pattern or empty.

```
Strategy phases:
  setup_defense:  Place trap (0xAAAA) at addresses 0x300, 0x340,
                  0x380, 0x3C0.
  patrol:         For each defensive point, scan the area before it
                  for non-trap, non-empty content.
  attack:         If something foreign found, overwrite with 0xFFFF
                  (DAT bomb pattern).
```

**Battle dynamics (from author's comments):**
- vs `vampire`: Strong initial defense, but can be overwhelmed by enough
  copies.
- vs `hunter`: Traps catch precise attacks, but vulnerable to carpet
  bombing.

**Known issues:** Uses `mov word [bx], trap` — the parser accepts `word`
as a no-op modifier, but the resulting bytecode may not write what the
author intended. Also relies on the predefined `defense_start` symbol;
also redefines it via `equ`.

### `hunter.asm` — active scanner with bombing fallback

> Walks memory in prime-step strides looking for non-zero cells. If it
> finds many, carpet-bombs the area; if few, drops a precise dart.

```
Strategy phases:
  init_scanner:   bx = 0x100, cx = 0x37 (prime step), dx = 0 (hit count)
  scan:           Read [bx]; if non-zero, increment dx and remember
                  location in si. Step by cx. Continue until bx >= 0xF000.
  hunt:           If dx >= 2, bomb 8 cells starting at si with 0xFFFF.
                  Else if dx >= 1, drop dart (0xF0F0) at si.
```

**Battle dynamics:**
- vs `vampire`: Highly effective at finding copies before they spread.
- vs `fortress`: Carpet bombing breaks through static defenses.

### `vampire.asm` — replicator

> Finds empty space, copies its own code there, and SPLs into the copy.
> Periodically attacks any non-empty cells it finds by XOR-corrupting
> them.

```
Strategy phases:
  find_space:     Scan from 0x200 upward, stepping by 0x10. First empty
                  cell found is the destination.
  replicate:      Copy code_size bytes from si (assumed = 'start') to
                  destination. SPL into destination.
  find_target:    Scan from 0x100, stepping by 2, for non-empty cells.
  attack:         XOR with 0xFFFF (corrupts the cell).
```

**Battle dynamics:**
- vs `fortress`: Slow start against defenses, but eventually swarms.
- vs `hunter`: Vulnerable while copying; hunter catches copies in
  flight.

**Known issues:** The `mov ax, [si]` / `inc si` copy loop assumes `si`
starts pointing at `start`, but nothing initializes `si`. The bot
inherits whatever `r1 = si` happens to contain. The prototype's loose
execution (unknown opcodes are NOPs) means it stumbles forward anyway.
For the rebuild, the bot author should explicitly `mov si, start`
before the copy.

## Painters (visualization showcases)

These bots don't fight effectively; they're designed to make the memory
canvas look spectacular.

### `RandomWriter1.asm` — chaotic painter (red region)

> Uses a linear congruential generator to compute a pseudo-random
> address based at 0x1000, writes pattern 0xAA, occasionally jumps to a
> new base.

The `mul/add` LCG (with constants 1103, 12345) produces a not-very-
random but reasonably scattered stream of writes. Combined with
periodic base jumps, the output looks like a shifting cloud of red dots
across the lower half of memory.

### `RandomWriter2.asm` — chaotic painter (different region & style)

> Different LCG constants (1597, 51749), starts at 0x8000, writes
> pattern 0x55, also reverses direction periodically (forward/backward
> moves of 7 and 5 bytes).

Pairing RandomWriter1 vs RandomWriter2 gives a visually striking demo of
two bots competing for memory turf.

## Test bots (minimal programs)

These exist to exercise specific opcodes or to debug parser/codegen
issues. Don't rate them as combatants.

### `simplest.asm`
```assembly
; Just halt.
halt
```

### `test1.asm`, `test2.asm`
```assembly
start:
halt           ; or: nop, halt
```

### `multi_nop.asm`
```assembly
nop
nop
nop
nop
nop
halt
```

### `scanner.asm`
```assembly
; Two NOPs and a halt.
nop
nop
halt
```

### `simple.asm`, `simple_copy.asm`
```assembly
mov r0, 1
mov r1, 2
add r0, r1
mov r2, r0
halt
```

Exercises register-to-register arithmetic.

### `simple_test.asm`
```assembly
nop
jmp 0x0
```

Infinite loop. Tests jump to absolute address.

### `simple_hunter.asm`
```assembly
mov r0, 10
scan:
add r0, 1
jmp scan
```

Forever-incrementing loop. Tests the scheduler more than anything.

### `counter.asm`
```assembly
mov r0, 0
loop:
inc r0
cmp r0, 10
jnz loop
halt
```

Counts to 10 and halts.

### `debug.asm`
```assembly
mov r0, 1
main_loop:
  inc r0
  cmp r0, 100
  jl main_loop
  mov r0, 0
  jmp main_loop
```

Counts to 100, resets, loops forever. Used for stress-testing the turn
loop.

### `infinite_loop.asm`

Uses raw absolute jump targets (no labels) to test that absolute jumps
work without label resolution. Always-running, never halts.

### `vampire_test.asm`

A simplified vampire that scans memory but doesn't actually replicate.
Used for testing the scan loop pattern.

### `test_jumps.asm`

Tests `jmp`, `call`, `ret`. Exercises the call stack.

### `test_spl.asm`

Tests the `spl` instruction. Verifies parent and child both run.

### `test-bot1.asm`, `test-bot2.asm`

Two minimal "warriors" that walk through memory writing bytes.
`test-bot1` writes 0x1234 in a loop, `test-bot2` scans for non-zero
and overwrites with 0x5678. Useful for a 2-bot smoke test.

## Suggested matchups

| Matchup | Why |
|---|---|
| `fortress` vs `hunter` | Defensive vs offensive. Showcases both strategies. |
| `vampire` vs `vampire` | Two replicators competing for memory. Watch the SPL cap. |
| `vampire` vs `fortress` | Author claims vampire eventually wins; verify. |
| `hunter` vs `vampire` | Author claims hunter favored; verify. |
| `RandomWriter1` vs `RandomWriter2` | Pure visualization eye candy. |
| `fortress` vs `hunter` vs `vampire` | The grand showcase: 3-way battle. |

## Bot ideas not yet shipped (for future work)

- **Imp** — single instruction that copies itself to PC+1 (`MOV 0, 1`-
  style). The simplest classic Core War warrior.
- **Dwarf** — increments a pointer and bombs every Nth cell in the
  core.
- **Stone** — like dwarf but with a "split" to multi-process for
  resilience.
- **Paper** — fast replicator that out-spawns dwarves.
- **Scanner+bomber** — hybrid that scans for non-empty cells, then
  drops bombs.
- **Vampire-clone** — replicator that copies the *opponent's* code over
  itself (vampires the enemy).
