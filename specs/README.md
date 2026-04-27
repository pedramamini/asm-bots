# ASM-Bots Specification Bundle

This directory is a self-contained specification of the **ASM-Bots** game,
distilled from a working (but messy) prototype implementation. It is written
to be the single source of truth for a fresh implementation — every document
should be readable in isolation, and together they define everything you need
to rebuild the game from scratch.

## What is ASM-Bots?

ASM-Bots is a modern, web-based take on the classic [**Core War**][corewar]
game. Two or more programs ("bots"), each written in a small assembly
language, are loaded into a shared circular memory and execute in parallel,
fighting until only one survives — or the cycle limit is reached. The twist
versus a strict Core War clone is that this dialect is **x86-flavored**: it
uses register-based syntax (`mov ax, bx`, `[r0+8]`, `cmp/jz`) rather than the
Redcode `MOV.AB #1, @2` style.

The game ships as a real-time browser experience: every memory cell colors
itself by the bot that last wrote it, you can see each bot's program counter
trail across the grid, and a websocket streams the action to one or more
spectators.

[corewar]: https://en.wikipedia.org/wiki/Core_War

## How to read these specs

Read in order. Each doc builds on the one before it.

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [`01-overview.md`](01-overview.md) | High-level vision, gameplay loop, glossary |
| 02 | [`02-architecture.md`](02-architecture.md) | Module layout, data flow, build/runtime topology |
| 03 | [`03-memory-model.md`](03-memory-model.md) | Core memory: addressing, ownership, protection |
| 04 | [`04-instruction-set.md`](04-instruction-set.md) | Opcodes, encoding, addressing modes, semantics |
| 05 | [`05-assembly-language.md`](05-assembly-language.md) | Source-level syntax: directives, labels, data, macros |
| 06 | [`06-parser-and-codegen.md`](06-parser-and-codegen.md) | Tokenizer, two-pass assembly, relocation |
| 07 | [`07-process-model.md`](07-process-model.md) | Processes, registers, SPL, scheduling |
| 08 | [`08-battle-system.md`](08-battle-system.md) | Battle lifecycle, turns, victory conditions |
| 09 | [`09-web-frontend.md`](09-web-frontend.md) | Memory canvas, dashboard, upload UX |
| 10 | [`10-server-and-protocol.md`](10-server-and-protocol.md) | HTTP API, WebSocket message contracts |
| 11 | [`11-bot-catalog.md`](11-bot-catalog.md) | Every shipped bot, its strategy, and source |
| 12 | [`12-implementation-notes.md`](12-implementation-notes.md) | Gotchas the prior prototype hit; do/don't list |
| 13 | [`13-rebuild-checklist.md`](13-rebuild-checklist.md) | A milestone-by-milestone build order |
| 14 | [`14-glossary.md`](14-glossary.md) | Terms in one place |

The actual bot source files live in [`bots/`](bots/) — those are real,
running programs from the prior prototype, ported verbatim.

## What this spec is NOT

- **Not** a literal port of the old TypeScript source. The previous
  implementation has accumulated workarounds and dead code; this spec
  describes the *intended* behavior, with notes flagging where the old code
  did something deliberately weird.
- **Not** a UI mockup spec. The old web UI is described by behavior (what
  events fire, what the grid shows), not by pixel-perfect layouts.
- **Not** committed to a particular language or framework. The reference
  prototype was Node + TypeScript + a hand-rolled WebSocket server, but
  nothing here forces that choice. Pick a language, ship the spec.

## Quick mental model

```
   ┌──────────────────────────────────────────────────────────────┐
   │  Memory: a single Uint8Array (default 64 KB), circular       │
   │                                                              │
   │   [bot A code...]   ....   [bot B code...]   ....            │
   │        ▲                          ▲                          │
   │        │ PC                       │ PC                       │
   │   ┌────┴─────┐               ┌────┴─────┐                    │
   │   │ Process A│               │ Process B│                    │
   │   │  r0..r3  │               │  r0..r3  │                    │
   │   │  sp,pc   │               │  sp,pc   │                    │
   │   └──────────┘               └──────────┘                    │
   │       │                            │                         │
   │       └─────── round-robin ────────┘                         │
   │                  scheduler                                   │
   └──────────────────────────────────────────────────────────────┘
```

Each bot is a process; processes share one big circular memory; the scheduler
gives each a quantum of cycles in turn; an instruction can `SPL` to spawn
another process for the same bot; whoever has at least one live process when
the dust settles wins.

## Reference prototype

The directory `/Users/pedram/Projects/asm-bots/` (the parent of this folder)
contains the original prototype in `src/`. When in doubt, you can peek at
it — but treat the spec here as authoritative.
