# 07 — Process Model

A **process** is one running instance of a bot. One bot can have many
processes via the `SPL` instruction. The scheduler picks one process at a
time to execute one instruction.

## Process record

```ts
type Process = {
  id: ProcessId        // 1, 2, 3, ... assigned at creation, never reused
  name: string         // bot name (display)
  owner: string        // username / "Player 1" / etc.
  priority: number     // scheduling priority (higher first); default 1
  quantum: number      // cycles before preemption; default 5
  cyclesUsed: number   // total cycles ever
  memoryUsed: number   // bytes occupied (sum of segment sizes)
  createdAt: number    // wall-clock ms
  lastRun: number      // wall-clock ms of last execution
  context: {
    registers: {
      r0: number, r1: number, r2: number, r3: number,
      sp: number, pc: number, flags: number
    }
    memory: MemorySegment[]   // metadata (start, size); the actual bytes
                              // live in the shared MemorySystem
    cycles: number            // cycles in current quantum
    state: 'Ready' | 'Running' | 'Blocked' | 'Terminated'
    currentInstruction: string  // mnemonic (for logging/UI)
  }
}
```

### Initial register state

```
r0 = r1 = r2 = r3 = 0
sp = 0xFFFF
pc = entryPoint   (assigned by loader)
flags = 0
```

The high bits of PC (above 16) are preserved across jumps but only the
low 16 are used as memory addresses. (Treat PC as 32-bit storage if you
like; it doesn't matter for correctness.)

## States

```
              create
                │
                ▼
            ┌─────────┐
            │  Ready  │◀────────────────┐
            └────┬────┘                 │ quantum expired
              schedule()                │
                │                       │
                ▼                       │
            ┌─────────┐                 │
            │ Running │─────────────────┘
            └────┬────┘
                 │ HALT, DAT, error
                 ▼
            ┌────────────┐
            │ Terminated │
            └────────────┘
```

`Blocked` is reserved for future use (e.g., I/O); shipping bots never
enter it.

## Scheduling

Two modes; `roundRobin: true` is the default.

### Round-robin (default)

Group all `Ready` processes by priority. Find the highest priority bucket.

- If the bucket has 1 process, schedule it.
- If multiple, pick the one *after* `lastScheduledId` in the bucket
  (wrap to first if `lastScheduledId` is at the end or absent). Update
  `lastScheduledId`.

The intent: at the highest priority level, processes share fairly. Lower-
priority processes only run if no higher-priority ones are Ready.

### Priority-only (`roundRobin: false`)

Just pick the highest-priority `Ready` process. If multiple tie, the
first one found wins. (Less fair, but useful for testing.)

### Quantum accounting

Each scheduling tick:

1. If a process is currently running, increment its `context.cycles`.
2. If `context.cycles >= quantum`, preempt: set state to `Ready`, reset
   `cycles = 0`, clear `runningProcess`.
3. Pick next process via the algorithm above. Mark it `Running`, set
   `lastRun = now`, reset its `cycles`.

The default quantum is **5**. Tune as desired but keep it small to
encourage interleaving.

## Process creation (`SPL`)

```assembly
spl target
```

When executed:

1. Check the global cap (`maxProcesses`, default 32). If at cap, silently
   no-op (parent continues).
2. Create a new process with:
   - Same `owner` and `name`
   - Same `priority` and `quantum`
   - Same `memorySegments` (shared by reference; this is the same
     bytes in the shared memory)
   - `pc = target`
   - `r0..r3 = 0`, `sp = 0xFFFF`, `flags = 0`
   - State = `Ready`
3. Add the new process to the active battle.
4. Parent continues at the next instruction (PC advances normally).

**Children are not copies.** They share the parent's bot identity and
memory layout. The owner / color / display name in the dashboard is the
parent's. The visualization shows them as separate PCs running through
the same colored region.

This is how `vampire.asm` spreads: it copies its code to a new memory
location, then `SPL`s into that copy.

## Termination

A process is terminated when:

1. It executes `HALT` (intentional).
2. It executes `DAT` (a data byte, treated as a bomb).
3. The execution unit throws an error (memory protection violation,
   etc.). Note: unknown opcodes do **not** terminate; they're treated as
   NOPs.

On termination:
- State becomes `Terminated`.
- `runningProcess` is cleared if this was the running one.
- `lastRun` is set to the termination time (used as a tiebreaker for
  victory).
- Resources are released: `context.memory` is cleared, registers zeroed,
  `currentInstruction` cleared. The owner map in shared memory is
  **not** cleared — those cells still belong to the (now-dead) process,
  visually.

## Per-bot vs. global process limits

The prototype mixes two limits:
- **`maxProcesses` in `SchedulerOptions`** — a per-`ProcessManager` cap.
  Default 100 in API setup, 32 in BattleSystem.
- **A hard 32 cap inside `SPL`** — checked against the active battle's
  process list.

For the rebuild: pick one. A reasonable scheme is:
- 32 total processes per battle (across all bots).
- Optionally: 16 per bot (so one prolific replicator can't starve
  others).

## Resource limits (optional)

Each process can have:
```ts
resourceLimits: {
  maxMemory: number,
  maxCycles: number,
  maxInstructions: number,
}
```

The prototype validates `maxMemory` at creation but never enforces
`maxCycles` or `maxInstructions`. The rebuild can ignore these unless
you want enforcement.

## Process scoring

`scores: Map<ProcessId, number>` in `BattleController`. Incremented by 1
each time the process executes an instruction. Used as a final tiebreaker
in winner determination.
