# 01 — Overview

## What the game is

ASM-Bots is a **Core War**-inspired arena game. Two or more programs are
loaded into a shared memory space and execute simultaneously. Each program
has the goal of staying alive while killing the others, typically by
overwriting their code with garbage instructions.

The two essential properties are:

1. **One memory.** All bots share the same circular memory; their code is
   data, and every cell is a legitimate target for any bot's writes.
2. **Concurrent execution.** Bots take turns at the instruction level (round
   robin), so there is no "Bot A's whole program runs, then Bot B's." A few
   instructions of A interleave with a few of B.

Unlike the original Core War (which uses **Redcode**, a four-mode 1-cell
instruction format), this dialect is **x86-like**: it has named registers
(`r0..r3`, with x86 aliases `ax/bx/cx/dx`), `[reg+offset]` memory syntax,
two-operand instructions, and a stack with `push`/`pop`/`call`/`ret`.

## The gameplay loop

From the player's perspective:

1. **Write a bot.** A `.asm` text file using the assembly dialect described
   in [`05-assembly-language.md`](05-assembly-language.md).
2. **Upload it.** Drag-and-drop in the browser, or POST it to the API.
3. **Pick opponents.** Add at least one more bot to the arena.
4. **Start the battle.** Click Start. The memory canvas fills with colored
   pixels — each bot's writes paint cells in that bot's color, and a bright
   white outline tracks each bot's program counter.
5. **Watch.** Bots scan, replicate, set traps, drop "bombs" (DAT
   instructions that kill any process executing them), and try to outlive
   each other.
6. **A winner is declared.** When only one bot has a living process — or the
   turn cap is reached — the game ends and a "Winner" modal pops up with
   stats: cycles executed, memory footprint, final PC, etc.

## Key parameters (defaults)

| Parameter | Default | Notes |
|---|---|---|
| Memory size | **65536 bytes (64 KB)** | Circular; address mod size |
| Max processes total | **32** | Across all bots combined |
| Max processes per battle (API limit) | **100** | Engine-side cap |
| Default quantum (cycles per process per turn) | **5** (small, for snappy interleaving) | Forces frequent process switching |
| Default max turns | **1000** | Hard cap to bound battle length |
| Default max cycles per turn | **100,000–1,000,000** | Varies by entry point; high values let CPU-bound bots progress |
| Tick rate of WebSocket updates | **20 Hz** (every 50 ms) | One executed instruction per tick |

These are starting values, not commandments. The new implementation should
accept all of them as configuration.

## Victory conditions (in priority order)

1. **Last bot standing.** Only one process from one owner is non-Terminated.
2. **Largest memory footprint** at end-of-battle. If multiple bots' processes
   are still alive when the cycle/turn cap hits, whichever bot owns the most
   memory cells wins.
3. **Highest score** as a final tiebreaker. "Score" = number of instructions
   the bot executed.

The old prototype also had a "longest-surviving process" tiebreaker. Pick
one rule and document it; don't ship two.

## Audience

- **Players** want to write small, expressive assembly programs and watch
  them duke it out. Expect them to be technical (people who like Advent of
  Code, retro programming, or who already know Core War).
- **Spectators** want a fast, colorful, satisfying memory visualization that
  reads at a glance — even at 20 fps with 65,536 cells.

## Non-goals (for v1)

- No accounts/persistence/leaderboards in the *minimum viable* version. The
  old prototype had stubs for SQLite-backed users and rankings; that's a
  later phase.
- No editor with intellisense in v1 — drag-and-drop a `.asm` file is fine.
- No tournament mode in v1.

## Glossary (cross-link to [`14-glossary.md`](14-glossary.md))

- **Bot** — a `.asm` source file plus its compiled bytes.
- **Process** — a single running instance of a bot (a PC + register set +
  ownership of memory). One bot can have many processes (via `SPL`).
- **Cycle** — execution of one instruction by one process.
- **Turn** — a batch of cycles, after which the controller checks victory.
- **Quantum** — how many cycles a process gets before the scheduler
  preempts it for another.
- **Owner** — for any memory cell, the process ID that most recently wrote
  it. Drives the visualization color.
