# 02 — Architecture

This doc is the 10,000-ft picture: what modules exist, what they own, and
how a bot file becomes a battle in the browser.

## High-level diagram

```
                  ┌──────────────────┐
   .asm source ──▶│  AssemblyParser  │── tokens + symbols ──┐
                  └──────────────────┘                       │
                                                             ▼
                                                  ┌──────────────────┐
                                                  │  CodeGenerator   │
                                                  └──────────────────┘
                                                             │
                                              instructions + segments
                                                             │
                                                             ▼
   ┌──────────────────┐  loadBot()  ┌─────────────────────────────────┐
   │   BattleSystem   │────────────▶│  TrackedMemorySystem  (1 array) │
   │  (orchestrator)  │             │  + ownership map (Uint16Array)  │
   └─────────┬────────┘             └─────────────────────────────────┘
             │
             │ creates                ┌──────────────────────┐
             │                        │   ProcessManager     │
             ├───────────────────────▶│  (Map<id, Process>)  │
             │                        │   + scheduler        │
             │                        └──────────────────────┘
             │
             │  delegates turn flow   ┌──────────────────────┐
             ├───────────────────────▶│  BattleController    │
             │                        │  (state machine)     │
             │                        └──────────────────────┘
             │
             │  one cycle = one      ┌──────────────────────┐
             └──────────────────────▶│  ExecutionUnit       │
                                     │  (interpret opcode)  │
                                     └──────────────────────┘
                                                ▲
                                                │ raw bytes
                                                │
                                     ┌──────────────────────┐
                                     │ InstructionDecoder   │
                                     └──────────────────────┘

   ┌─────────────────────────┐
   │  HTTP / WebSocket API   │  ◀── browser
   │  (Express + ws)         │
   └─────────────────────────┘
              │
              ▼
   ┌─────────────────────────┐
   │  Web frontend           │
   │  - MemoryVisualization  │  (canvas)
   │  - Dashboard            │  (process list, metrics)
   │  - BattleClient         │  (websocket plumbing)
   └─────────────────────────┘
```

## Module ownership

| Module | Owns | Talks to |
|--------|------|----------|
| **AssemblyParser** | Source string → tokens + symbol table + parse errors | nothing |
| **CodeGenerator** | Tokens → `Instruction[]` → `MemorySegment[]` | symbol table from parser |
| **MemorySystem** | The bytes; bounds normalization; protection bitmap | nothing |
| **TrackedMemorySystem** | (extends MemorySystem) ownership map | `MemorySystem` |
| **InstructionDecoder** | Raw byte → opcode + operand tags | nothing (pure) |
| **ExecutionUnit** | One-shot ALU/control-flow execution against memory | `MemorySystem` |
| **ProcessManager** | Process records, scheduling, quantum accounting | nothing |
| **BattleController** | Turn loop, winner determination, log buffer | `ProcessManager` |
| **BattleSystem** | Orchestrates everything: load bot, drive turn loop | all of the above |
| **WebSocket server** | Per-battle subscriber list, broadcasts | `BattleSystem` |
| **HTTP API** | Bot CRUD + battle CRUD | `BattleSystem` |
| **Frontend** | Canvas rendering, drag-and-drop, modal | WebSocket |

The dependencies form a strict DAG. Don't add upward references (e.g., the
parser must not know about `BattleSystem`).

## Data flow: from `.asm` to running battle

1. **Upload.** Browser sends `{ name, code }` to either `POST /api/bots`
   (persisted) or directly into `battle.create` over the WebSocket.
2. **Parse.** `AssemblyParser.parse(code)` returns `{ tokens, errors,
   symbols }`. If `errors.length > 0`, reject with a 400.
3. **Encode.** `CodeGenerator.encode(tokens, symbols)` returns
   `Instruction[]` (opcode, operands, size).
4. **Layout.** `CodeGenerator.layout(instructions, symbols)` returns
   `GeneratedCode` = `{ segments: MemorySegment[], entryPoint: number }`.
   This is bytes packed into one or more named segments (typically just
   `code`).
5. **Place.** Pick a random base address `M` in `[0, MEMORY_SIZE * 0.8)`,
   then `codeGenerator.relocate(M)` rewrites all absolute jump/call/spl
   targets to `segment.start + relative_offset`. Symbols also shift by `M`.
6. **Create process.** `ProcessManager.create({ memorySegments, entryPoint,
   ... })` returns a `processId`. Initial registers: `r0..r3 = 0`,
   `sp = 0xFFFF`, `pc = entryPoint`.
7. **Write bytes into shared memory.** Set the memory's "current process" to
   the new pid (so ownership tracking attributes those writes), then write
   each segment byte-by-byte.
8. **Add to battle.** `battleController.addProcess(processId)`. Repeat steps
   2–8 for each bot.
9. **Start.** `battleController.start()`. The controller flips state from
   `pending` → `running`.
10. **Run.** A driver loop (either the WebSocket server's 50 ms interval or
    `BattleSystem.runBattle()` for headless mode) repeatedly calls
    `nextTurn()`. Each turn = many cycles; each cycle = `processManager
    .schedule()` picks a process, `BattleSystem.executeInstruction()` runs
    one instruction for it.
11. **Broadcast.** After each tick, the WebSocket server sends three
    messages: `memory.update` (which cells changed and to whom),
    `process.update` (PCs, instruction text, memory footprint), and
    `battle.update` (turn counter, metrics).
12. **End.** When only one bot has live processes (or a cap is hit), emit
    `battle.ended` with `{ winner, reason, stats, totalTurns }`.

## Build/runtime topology

The reference prototype is a single Node process serving both HTTP and
WebSocket on **port 8080**. Static assets are served from `dist/web/` after
TSC compilation.

For a clean rebuild, you can:
- Keep one process (simplest).
- Or split into a backend (battle engine, API, WebSocket) and a frontend
  served by Vite/whatever. There's nothing cross-cutting that prevents
  this.

## Concurrency model

The battle engine is **single-threaded by design**. There is no async during
instruction execution; one instruction runs to completion before the next.
This makes the battle deterministic given a fixed initial layout and
scheduler order. (Random bot placement is the only nondeterminism, and you
can fix that with a seeded RNG for repeatable replays.)

WebSocket I/O is async, but it only reads battle state — it does not
execute instructions itself.

## What the prototype got wrong here

- The prototype has **two parallel BattleSystem instances** at module-load
  time: one global and one per-battle, with logic split awkwardly. New
  code: one `BattleSystem` per active battle, lifetime tied to the battle.
- The prototype mutates `process.context.memory` segments in place across
  `SPL` (children "share memory segments" via reference). This is fine
  *only* because nobody actually mutates the segment objects — but it's a
  trap. New code: store segment metadata on the bot, not per-process.
