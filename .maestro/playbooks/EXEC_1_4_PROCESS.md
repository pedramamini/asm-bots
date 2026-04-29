# EXEC_1_4_PROCESS: Implement Process & Scheduler

This playbook details the implementation of the process management and scheduling system.

## 🛠 Implementation Tasks

### 1. Core Data Structures
- [x] Define `Process`, `ProcessContext`, and `ProcessState` types in a new `core/process.ts` or similar location.
- [x] Implement `ProcessId` generation logic (incremental, non-reusing).

### 2. Process Manager
- [x] Create a `ProcessManager` class to maintain the list of active processes.
- [x] Implement `createProcess(params)` to handle the `SPL` logic:
    - Check global process cap (32).
    - Copy parent's metadata (owner, priority, quantum).
    - Initialize child's registers to default state.
    - Set initial PC to the target address.
- [x] Implement `terminateProcess(pid)` to handle resource release and timestamping.

### 3. The Scheduler
- [x] Implement the `Scheduler` class.
- [x] Implement the Priority-Based Round-Robin algorithm as defined in `specs/design/SCHEDULER_SPEC.md`.
- [x] Implement a `tick()` method that handles quantum accounting (increment $\rightarrow$ check $\rightarrow$ preempt $\rightarrow$ schedule).
- [x] Integrate the `tick()` method into the main execution loop.

### 4. Integration & Testing
- [x] Integrate `ProcessManager` and `Scheduler` with the `BattleSystem`.

- [x] Write a test case for `SPL` replication (e.g., a bot that spawns 32 processes and then halts).
- [x] Write a test case for priority preemption (e.g., a high-priority process interrupting a low-priority one).
- [x] Verify that a process executing a `DAT` byte is immediately terminated.
