# 13 — Rebuild Checklist

A milestone-by-milestone build order, designed so each step produces
something you can run. Don't skip ahead — order matters.

## Milestone 0 — Project skeleton

- [ ] Pick a backend language/framework. (Rust + axum, or TS + Bun, or
      Python + FastAPI all work.)
- [ ] Set up a build system, formatter, linter, and test runner.
- [ ] Create a directory layout: `core/`, `parser/`, `engine/`,
      `server/`, `web/`, `bots/`, `tests/`.
- [ ] Add a CI step that runs the test suite on every push.

**Done when:** `<runner> test` passes with zero tests.

## Milestone 1 — Memory system

- [ ] Implement `MemorySystem` with `read`, `write`, `protect`,
      `unprotect`, `getMemory`. All addresses normalize via
      `((addr % SIZE) + SIZE) % SIZE`.
- [ ] Implement `TrackedMemorySystem` extension with ownership tracking
      via `Uint16Array`. `setCurrentProcess(pid)` sets which pid is
      attributed for subsequent writes.
- [ ] Unit tests:
  - Read/write roundtrips at low, mid, high addresses.
  - Wrap-around: `read(SIZE)` returns same as `read(0)`,
    `read(-1)` returns `read(SIZE-1)`.
  - Ownership updates correctly on write.

**Done when:** all memory tests green.

## Milestone 2 — Parser

- [ ] Implement `AssemblyParser`:
  - Tokenize all opcodes from the [opcode list](04-instruction-set.md).
  - Tokenize all directives.
  - Tokenize labels, registers, immediates, hex/$/0x numbers,
    `[mem]` access, symbols.
  - Two-pass: pass 1 builds symbol table with byte-correct addresses;
    pass 2 emits tokens.
  - Collect errors, don't throw.
- [ ] Unit tests:
  - Parse every `.asm` file in `bots/`. None should produce errors.
  - Parse intentionally broken inputs and check error messages.
  - Symbols resolve correctly for forward references (`jmp loop`
    where `loop:` is below).

**Done when:** all 22 shipped bots parse cleanly.

## Milestone 3 — Code generator

- [ ] Implement `CodeGenerator`:
  - `encode(tokens, symbols) -> Instruction[]`
  - `layout(instructions, symbols) -> { segments, entryPoint }`
  - `relocate(baseAddress)` — fix up jump/call/SPL targets in the byte
    stream and shift all symbols.
- [ ] Unit tests:
  - Encode each shipped bot, verify byte layout matches a snapshot.
  - Verify relocation produces correct absolute jump targets.
  - Verify symbols are correctly shifted post-relocate.

**Done when:** every bot encodes deterministically and bytes match
expected layout.

## Milestone 4 — Process model

- [ ] Implement `ProcessManager`:
  - `create(opts)` returns new pid.
  - `terminate(pid, reason)` sets state.
  - `schedule()` returns next pid (round-robin within priority).
  - `getProcess(pid)`, `getRunningProcess()`, `getStats()`.
- [ ] Unit tests:
  - Create N processes, verify each gets a unique pid.
  - Schedule cycles through ready processes evenly.
  - Termination removes from rotation.
  - Hitting `maxProcesses` raises an error on `create`.

**Done when:** scheduler exhibits round-robin behavior under test.

## Milestone 5 — Execution unit

- [ ] Implement instruction interpretation for every opcode in the
      [opcode table](04-instruction-set.md).
  - MOV / arithmetic / logical / shift
  - Conditional jumps (using r0 sign/zero, *not* a flags register)
  - PUSH / POP / CALL / RET
  - SPL spawning new processes
  - DAT termination
  - Unknown opcode → NOP, advance PC by 1
- [ ] Wire into a minimal driver: load one bot, run it for N cycles,
      assert final register state.
- [ ] Unit tests:
  - One test per opcode, asserting register/memory effect.
  - SPL creates a process, parent and child both advance correctly.
  - `dat` terminates.
  - `halt` terminates.
  - PC wrap-around works (jump to address > SIZE wraps).

**Done when:** `counter.asm` correctly counts to 10 and halts.

## Milestone 6 — Battle controller (single-process)

- [ ] Implement `BattleController`:
  - `addProcess(pid)`, `start()`, `pause()`, `reset()`, `nextTurn()`.
  - State machine: `pending → running → paused/completed`.
  - Score map per process.
  - Execution log (ring buffer).
- [ ] Wire `BattleController` to `ProcessManager` and the execution
      unit via `onBeforeExecution`.
- [ ] Headless test: run `simple_hunter.asm` for 100 cycles, assert
      r0 incremented 90 times (10 to enter loop, then 90 inside).

**Done when:** you can run a single bot for N cycles in pure code.

## Milestone 7 — Multi-bot battles

- [ ] Implement `BattleSystem`:
  - `loadBot(filePath, owner)` does parse → encode → layout →
    randomize base → relocate → write bytes → create process →
    add to controller.
  - `runBattle(turns)` for headless runs.
  - `executeInstruction()` reads the byte at PC, decodes, dispatches
    to the execution unit.
- [ ] Implement victory determination:
  - Last bot standing → that bot wins.
  - Otherwise: largest memory footprint.
  - Final tiebreaker: highest score.
- [ ] Headless test: `fortress.asm` vs `hunter.asm`, assert one wins.

**Done when:** combat bots produce reasonable battle outcomes.

## Milestone 8 — HTTP API

- [ ] Implement REST endpoints:
  - `GET /api/version`
  - `GET /api/bots`, `GET /api/bots/:id`, `POST /api/bots`,
    `DELETE /api/bots/:id`
  - `POST /api/battles`, `GET /api/battles/:id`,
    `POST /api/battles/:id/start`, `POST /api/battles/:id/turn`
  - `GET /health`
- [ ] In-memory storage (Maps) is fine for v1.
- [ ] Smoke test with curl: create bot, create battle, start, get
      results.

**Done when:** end-to-end battle from curl works.

## Milestone 9 — WebSocket

- [ ] Implement WebSocket endpoint at `/ws`.
- [ ] Message types from [10-server-and-protocol](10-server-and-protocol.md):
      `subscribe`, `battle.create/start/pause/reset/step`.
- [ ] Server emits: `battle.created/started/paused/reset/update/ended`,
      `memory.update`, `memory.access`, `process.created/update/
      terminated`, `error`.
- [ ] Auto-step interval at 50 ms while battle is running.

**Done when:** a Node REPL test client can drive a battle to
completion via WebSocket.

## Milestone 10 — Frontend (memory canvas)

- [ ] Static HTML with canvas, dashboard skeleton, upload zone.
- [ ] `MemoryVisualization` renders the cell grid:
  - 256 columns × N rows.
  - Hex address labels on left margin.
  - Cell size from a slider.
  - Color cells by ownership.
  - Render PC outlines (white rectangles).
  - Animate write flashes (white) and execute trails (yellow), fading
    over 1 sec.
- [ ] `BattleClient` connects to WebSocket, dispatches messages.
- [ ] `Dashboard` shows per-bot cards with state, PC, cycles,
      memory footprint.
- [ ] Drag-and-drop to upload `.asm` files; "Create Battle" button.

**Done when:** you can drag two `.asm` files in, click Create
Battle, click Start, and watch the bots fight on the canvas.

## Milestone 11 — Winner modal & metrics

- [ ] Listen for `battle.ended`, show modal with stats.
- [ ] Update execution speed (IPS), memory efficiency, battle progress
      tiles in real time.
- [ ] Streaming log textarea below the dashboard for important events.

**Done when:** end-of-battle UX is satisfying.

## Milestone 12 — Polish

- [ ] Theme toggle (dark/light), persisted to `localStorage`.
- [ ] Pause / resume / reset controls work end-to-end.
- [ ] Multi-battle support (subscribe to specific battle IDs).
- [ ] Bot legend in the memory panel.
- [ ] Error toasts for parse failures.

## Milestone 13 — Optional features

- [ ] SQLite-backed bot/battle persistence.
- [ ] User accounts + JWT.
- [ ] Bot editor with syntax highlighting (Monaco).
- [ ] Replay/scrubbing.
- [ ] Tournament mode (round-robin all uploaded bots).
- [ ] Leaderboard.
- [ ] Step / step-N controls in the UI.

## Validation

Run all 22 bots through your parser. All should parse without errors.
Then run these matchups headlessly and verify each completes (winner
declared, no exceptions):

- `simplest.asm` vs `simplest.asm` (both halt → no winner)
- `counter.asm` vs `counter.asm` (both halt → no winner; tiebreaker)
- `fortress.asm` vs `hunter.asm`
- `vampire.asm` vs `vampire.asm`
- `vampire.asm` vs `fortress.asm`
- `RandomWriter1.asm` vs `RandomWriter2.asm` (visual; should run for
  full max-turns since neither halts)
- 4-way: `fortress.asm` vs `hunter.asm` vs `vampire.asm` vs
  `simple_hunter.asm`
