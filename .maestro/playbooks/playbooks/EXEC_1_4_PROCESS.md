# EXEC_1_4_PROCESS: Implement Process & Scheduler

This playbook details the implementation of the process management and scheduling system.

## 🛠 Implementation Tasks

### 1. Core Data Structures
- [ ] Define `Process`, `ProcessContext`, and `ProcessState` types in a new `core/process.ts` or similar location.
- [ ] Implement `ProcessId` generation logic (incremental, non-reusing).

### 2. Process Manager
- [ ] Create a `ProcessManager` class to maintain the list of active processes.
- [ ] Implement `createProcess(params)` to handle the `SPL` logic:
    - Check global process cap (32).
    - Copy parent's metadata (owner, priority, quantum).
    - Initialize child's registers to default state.
    - Set initial PC to the target address.
- [ ] Implement `terminateProcess(pid)` to handle resource release and timestamping.

### 3. The Scheduler
- [ ] Implement the `Scheduler` class.
- [ ] Implement the Priority-Based Round-Robin algorithm as defined in `specs/design/SCHEDULER_SPEC.md`.
- [ ] Implement a `tick()` method that handles quantum accounting (increment $\rightarrow$ check $\rightarrow$ preempt $\rightarrow$ schedule).
- [ ] Integrate the `tick()` method into the main execution loop.

### 4. Integration & Testing
- [ ] Integrate `ProcessManager` and `Scheduler` with the `BattleSystem`.
- [ ] Write a test case for `SPL` replication (e.g., a bot that spawns 32 processes and then halts).
- [ ] Write a test case for priority preemption (e.g., a high-priority process interrupting a low-priority one).
- [ ] Verify that a process executing a `DAT` byte is immediately terminated.
