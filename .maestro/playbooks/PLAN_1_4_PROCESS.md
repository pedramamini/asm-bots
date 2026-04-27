# PLAN_1_4_PROCESS: Process & Schedule Design

## 🔍 Analysis & discovery
- [x] Analyze `specs/07-process-model.md` to finalize the `Process` state object
- [x] Map the the scheduling lifecycle: `Ready` $\rightarrow$ `Running` $\rightarrow$ `Preempted` $\rightarrow$ `Terminated`
- [x] Analyze the `SPL` (Spawn) constraints and the global process cap logic
- [x] Define the exact quantum accounting mechanism (cycles per process)

## 📄 Documentation Output
- [x] Produce `specs/design/PROCESS_SPEC.md`: A detailed state-machine diagram and object definition for the Process model
- [x] Produce `specs/design/SCHEDULER_SPEC.md`: A formal specification of the round-robin scheduling algorithm
- [x] Produce `playbooks/EXEC_1_4_PROCESS.md`: A granular, step-step execution playbook for implementing the ProcessManager and Scheduler.
