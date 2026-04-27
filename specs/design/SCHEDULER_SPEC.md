---
type: reference
title: Scheduler Specification
created: 2026-04-27
tags:
  - scheduler
  - round-robin
  - priority-scheduling
related:
  - '[[PROCESS_SPEC]]'
---

# Scheduler Specification

The Scheduler determines which `Process` in the `Ready` state is selected for execution.

## 1. Scheduling Algorithm

The system implements a **Priority-Based Round-Robin** scheduler.

### Priority Buckets
All `Ready` processes are grouped by their `priority` level. 

### Selection Logic
The scheduler always selects from the highest priority bucket that contains at least one `Ready` process.

#### Round-Robin Selection (Default)
If multiple processes exist in the highest priority bucket:
1. **Reference Pointer**: Maintain a `lastScheduledId` pointer.
2. **Circular Queue**: Select the process with the next ID in the bucket relative to `lastScheduledId`.
3. **Wrap-around**: If the pointer is at the end of the bucket or null, start from the first process.
4. **Update**: Update `lastScheduledId` to the selected process's ID.

#### Priority-Only Selection (Debug Mode)
If `roundRobin` is disabled:
1. Select the first process found in the highest priority bucket.

## 2. Quantum Accounting

The Scheduler tracks execution time via "cycles" to ensure fairness.

### The Scheduling Tick
Each time the execution unit attempts to execute an instruction:

1. **Cycle Increment**: Increment the running process's `context.cycles`.
2. **Quantum Check**: Compare `context.cycles` against the process's `quantum`.
3. **Preemption**: 
   - If `context.cycles >= quantum`, the process is **preempted**.
   - Action: Set state to `Ready`, reset `context.cycles = 0`, and clear the global `runningProcess` reference.
4. **Next Process Selection**:
   - If no process is currently `Running`, the scheduler invokes the Selection Logic to pick the next `Ready` process.
   - Action: Mark the selected process `Running`, update `lastRun` timestamp, and reset its `context.cycles = 0`.

## 3. Scheduling Constraints

- **Default Quantum**: 5 cycles.
- **Interleaving**: Small quanta are used to encourage high-frequency interleaving of bot behaviors, making the battle simulation feel dynamic.
- **Fairness**: Lower priority processes only execute if no higher priority processes are in the `Ready` state.
