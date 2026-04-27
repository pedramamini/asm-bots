# 03 — Memory Model

## The core

A single `Uint8Array` of configurable size — **default 65536 bytes (64 KB)**.
Cell width is **1 byte**; instructions are **multi-byte** (see encoding in
[`04-instruction-set.md`](04-instruction-set.md)).

```
  Address   0x0000                                          0xFFFF
            ┌─────┬─────┬─────┬─ ... ─┬─────┬─────┬─────┐
   Memory   │  0  │  0  │ MOV │       │ JMP │  0  │  0  │   (Uint8Array)
            └─────┴─────┴─────┴─ ... ─┴─────┴─────┴─────┘
```

## Circular addressing

Every read or write normalizes the address:

```
address_eff = ((address mod SIZE) + SIZE) mod SIZE
```

The `+ SIZE` and second mod handle negative inputs cleanly (so
`memory[-1]` reads from `SIZE - 1`). This applies to **every** memory
access — instruction fetch, data load, data store, stack push/pop. There
are **no out-of-bounds errors**: bots cannot crash by walking off the end
of memory; they wrap.

This is the central design feature. It enables many classic Core War
strategies (scanning the entire core by stride, "imp" replicators that
stride forever, etc.).

## Word size & alignment

- Cell width: **1 byte** (so the memory is a `Uint8Array`, not a
  `Uint16Array`).
- Instructions occupy **1, 2, or 3 bytes** depending on opcode (see
  [`04-instruction-set.md`](04-instruction-set.md)).
- 16-bit values (jump targets, register values stored to memory) are
  little-endian: `[low byte, high byte]`.
- There is **no alignment requirement** at the engine level — you can write
  one byte at any address. Assemblers may emit unaligned data.

## Ownership map

Layered on top of the byte array is a **`Uint16Array` of equal length**,
the *owners* map. Each cell stores the process ID of whichever process most
recently wrote that cell. **Ownership is per-cell, not per-segment.**

```
   memory:  [0x10][0xFF][0x00][0x42][0xAB] ...
   owners:  [  3 ][  3 ][  0 ][  7 ][  7 ] ...
```

A `0` owner means "unowned" — never written, or written by the loader with
no current process set.

The owner ID is set automatically on every write: the memory system tracks
a *current process* (set via `setCurrentProcess(pid)`), and any subsequent
write tags the cell with that pid. The execution loop sets the current
process before stepping a process, then clears it.

The frontend reads owners to colorize cells.

## Protection

The memory system supports a **per-cell protection bit** (`Set<number>` of
protected addresses). Writes to a protected cell throw and log a violation.

In v1 of the rebuild this is **optional** — none of the shipped bots rely
on it. The hooks should exist for later (e.g., to mark a "spawn shield" or
implement an arena with read-only zones), but you can ship without using
it. If you do enable protection, processes must not be killed for trying
to write protected memory; just no-op the write and log a violation.

## Memory layout policy (where bots get loaded)

When a bot is loaded, its base address is randomized:

```
M = floor(random() * (MEMORY_SIZE * 0.8))
```

Multiplying by `0.8` keeps bots away from the very end so they have room
to grow without immediately wrapping. There is **no overlap check** — bots
*can* be loaded on top of each other. (In practice, with a 64 KB core and
small bots, this is rare.)

You may improve this in the rebuild:
- Reject overlapping placements and re-roll.
- Or require a minimum spacing (e.g., 1 KB between bot bases).

The original prototype just accepts overlap.

## Memory access API (logical)

```ts
class MemorySystem {
  read(address: number): number          // returns 0..255, never throws
  write(address: number, value: number)  // value & 0xFF, may throw if protected
  protect(address: number): void
  unprotect(address: number): void
  isProtected(address: number): boolean
  getMemory(): Uint8Array                // for visualization (copy)
}

class TrackedMemorySystem extends MemorySystem {
  setCurrentProcess(pid: ProcessId | null): void
  getOwner(address: number): ProcessId   // 0 if unowned
  getOwners(): Uint16Array               // for visualization (copy)
  setOwnershipRange(start, size, owner): void   // for initial code load
}
```

There is also an **allocation API** in the prototype (first-fit
`allocate(size) -> address`, plus `free(address)`). It is not used by the
battle system itself — bots don't have malloc — and you can drop it
unless you have a specific use. The prototype kept it around as a
hangover from an earlier design where each bot got a private arena.

## Memory access logging

The memory system maintains a small `accessLog` of violations
(protection, bounds, allocation). The execution loop drains this log after
each instruction and logs warnings — but does not terminate the process.
Memory violations are non-fatal.

## Visualization color rules

Out of scope for this doc; see [`09-web-frontend.md`](09-web-frontend.md).
But the relevant memory contract is:

- A cell with `memory[i] != 0` and `owners[i] != 0` paints in the owner's
  color (~70% alpha).
- A cell with `memory[i] == 0` paints as background, regardless of owner.
- Recent writes (by timestamp, fading over ~1 sec) flash white.
- Recent execute accesses (PC visits) flash bright yellow with a fading
  "trail" effect.
- Each live process's current PC is outlined in solid white.
