# 08 — Battle System

The **BattleSystem** is the orchestrator that ties everything together.
The **BattleController** is its state machine. This doc covers both.

## BattleOptions

```ts
type BattleOptions = {
  maxTurns: number              // hard cap on turns (default 1000)
  maxCyclesPerTurn: number      // cycles per turn (default 100,000+)
  maxMemoryPerProcess: number   // bytes; rejects bots larger than this
  maxLogEntries: number         // size of execution log ring buffer

  memorySize?: number           // override 65536
  coreDump?: boolean            // dump memory on crash (debug)
  cycleLimit?: number           // global cycle limit
  timeLimit?: number            // wall-clock cap in ms
  roundRobin?: boolean          // scheduler mode
}
```

Sensible defaults for v1:

```ts
{
  maxTurns: 1000,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 4096,
  maxLogEntries: 1000,
  memorySize: 65536,
  roundRobin: true,
}
```

For longer headless battles use `maxTurns: 2000, maxCyclesPerTurn:
1000000`.

## Lifecycle

```
                ┌──────────┐
                │ pending  │
                └────┬─────┘
        addProcess() │
                     │
                  start()
                     │
                     ▼
                ┌──────────┐
                │ running  │◀─── nextTurn() ─── (in loop)
                └────┬─────┘
            pause()  │  end conditions met
                     │  (1 active process,
                     │   maxTurns, etc.)
                     ▼
              ┌──────────┐
              │  paused  │ ──── start() ──┐
              └──────────┘                │
                     │                    │
                     ▼                    │
              ┌────────────┐              │
              │ completed  │◀─────────────┘
              └────────────┘
```

`reset()` returns to `pending` with all processes reset (PC randomized to
a new offset within their code segment).

## The turn loop

A **turn** is one call to `BattleController.nextTurn()`. It runs many
**cycles** (one cycle = one instruction).

```python
def next_turn():
  if state.status != 'running': return False
  if state.turn >= maxTurns:
    end_battle(); return False

  active = count of non-terminated processes
  if active == 0:
    end_battle(); return False

  cycles_this_turn = 0
  processes_run = set()
  cycles_per_proc = {}

  target_min = active * 5   # ensure each process gets at least 5 cycles

  while cycles_this_turn < maxCyclesPerTurn:
    pid = scheduler.schedule()
    if pid is None: break

    cycles_per_proc[pid] = cycles_per_proc.get(pid, 0) + 1
    log_execution(pid)

    on_before_execution(pid)   # hook -> BattleSystem.executeInstruction()
    scores[pid] += 1
    cycles_this_turn += 1
    processes_run.add(pid)
    on_after_execution(pid)

    if cycles_this_turn >= target_min and len(processes_run) >= active:
      break

  state.turn += 1
  if check_victory():
    end_battle(); return False
  return True
```

The "target_min × active" early-exit is the prototype's hack to keep
turns bounded but fair. You can simplify in the rebuild:

```python
for _ in range(maxCyclesPerTurn):
  pid = scheduler.schedule()
  if pid is None: break
  execute_one(pid)
```

The fairness comes from round-robin scheduling, not from the turn loop.

## The execution hook

`BattleController` doesn't know how to execute instructions; it calls
`onBeforeExecution(pid)` for that. `BattleSystem` wires this to its own
`executeInstruction()`:

```ts
controller.onBeforeExecution = (pid) => {
  const ok = battleSystem.executeInstruction()
  if (!ok) console.log(`failed to execute for ${pid}`)
}
```

`executeInstruction()` does:
1. Read PC of the running process.
2. Set the memory's `currentProcess = pid` (for ownership tracking).
3. Decode the byte at PC into opcode + operand bytes (size 1, 2, or 3).
4. Call `executeOpcodeForProcess(pid, opcode, operands)`. This is one
   giant switch over opcodes, see [`04-instruction-set.md`](04-instruction-set.md)
   for semantics.
5. If the opcode didn't manipulate PC itself, advance PC by instruction
   size.
6. If opcode was HALT or DAT, terminate the process.
7. Clear `currentProcess`.
8. Return success/failure.

The "did the opcode manipulate PC?" signal is the boolean return of
`executeOpcodeForProcess`: jumps return `false` (don't auto-advance);
everything else returns `true`.

## Victory determination

After every turn, `checkVictory()`:

1. Count active (non-Terminated) processes.
2. If exactly **1** active: that process's owner wins. `winner = pid`.
3. If **0** active or `turn >= maxTurns`:
   - **Owner-based winner.** Compute "memory footprint per *owner*"
     (sum of cells in the ownership map for each unique owner).
     Highest footprint wins.
   - **Fallback:** highest cumulative score (instructions executed).
   - **Final fallback:** the process with the latest `lastRun` (survived
     longest).
4. Else: continue.

The result emits as `battle.ended`:

```ts
{
  battleId: string,
  winner: ProcessId | null,
  reason: 'last_standing' | 'memory_footprint' | 'time_limit' | 'cycle_limit',
  stats: {
    name: string,
    owner: string,
    memoryFootprint: number,   // bytes owned at end
    cyclesExecuted: number,
    finalPC: number,
  },
  totalTurns: number,
}
```

## End-of-battle housekeeping

`endBattle()`:
1. `state.status = 'completed'`
2. `state.endTime = now()`
3. Terminate all remaining processes (so their state is consistent for
   final reporting).

## Reset

`reset()`:
1. For each process, randomize its PC to a new aligned offset within its
   code segment (helps re-runs feel different).
2. Reset registers (r0..r3 = 0, sp = 0xFFFF, flags = 0).
3. Reset cycle counters and current instruction.
4. State = `Ready`.
5. New battle state with score map cleared, `turn = 0`, `status =
   'pending'`.
6. **Note:** the prototype creates a fresh `MemorySystem` on reset
   (zeroing all bytes). The bots are NOT re-loaded — their byte data is
   lost. This is a bug; the rebuild should either re-load all bots from
   their stored bytes, or skip the memory wipe.

## Headless runs

`BattleSystem.runBattle(turns?)` is the headless API used by the CLI
(`runBattle.ts`). It:
1. Calls `setupExecutionHandlers()` to wire `onBefore/AfterExecution`.
2. Calls `battleController.start()`.
3. Loops `nextTurn()` up to `turns` (or until completion).
4. Returns `{ winner, scores, duration, turns }`.

Use this for tournament-style automation, regression tests, etc.
