# 14 — Glossary

Terms used throughout the specs.

| Term | Definition |
|---|---|
| **Bot** | A program written in the ASM-Bots assembly language, identified by its `.asm` source file or its compiled byte representation. One bot = one identity (name + owner). |
| **Process** | A running instance of a bot. Each process has its own PC, register set, and stack pointer. One bot can have multiple processes (via `SPL`). |
| **Core** / **Memory** | The single shared `Uint8Array` (default 64 KB) that all bots execute in and write to. Circular: address arithmetic wraps. |
| **Cell** | One byte of the core. Has a value (0–255) and an owner (0 = unowned, otherwise a process ID). |
| **Owner** | The process ID of whichever process most recently wrote a cell. Drives visualization color. Inherited from the bot when first loaded. |
| **Cycle** | The execution of a single instruction by a single process. The smallest unit of game time. |
| **Turn** | A batch of cycles between victory checks. Bounded by `maxCyclesPerTurn`. |
| **Quantum** | The number of cycles a process gets before the scheduler preempts it for the next process. Default 5. |
| **Round-robin** | Scheduling policy: at the highest available priority, processes take turns one cycle at a time. |
| **Score** | Cumulative count of cycles a process has executed. Used as a victory tiebreaker. |
| **Memory footprint** | Number of cells whose owner is a given process (or bot). Primary tiebreaker for victory when multiple bots survive. |
| **PC** (program counter) | The address of the next instruction to execute. 16-bit usable; high bits preserved across jumps. |
| **SP** (stack pointer) | The address of the top of stack. Initialized to `0xFFFF`. Stack grows downward. |
| **Opcode** | The 1-byte numeric identifier for an instruction (e.g., `0x10` = MOV). |
| **Operand** | A byte (or 16-bit value, for jumps) that follows an opcode and parameterizes it. |
| **Addressing mode** | How an operand is interpreted: register / immediate / direct memory / indirect / indexed. In this engine, operands < 4 are registers, ≥ 7 are immediates, and `0x8000`-tagged values are memory references. |
| **Register** | One of `r0`, `r1`, `r2`, `r3`, plus special `sp`, `pc`, `flags`. x86-style aliases: `ax=r0`, `bx=si=r1`, `cx=di=r2`, `dx=r3`. |
| **Immediate** | A literal value embedded in the instruction (vs. read from memory). |
| **Memory access** | An operand of the form `[addr]`, `[reg]`, or `[reg+offset]` — encoded as a 16-bit value with the high bit set. |
| **Symbol** | An identifier in the source that resolves to a numeric value. Includes labels (addresses) and equates (constants). |
| **Label** | A symbol whose value is the address it appears at in source order. |
| **Equate** | A symbol assigned a value via `name equ value`. |
| **Section** | A region of the bot's compiled output (`.code`, `.data`, `.const`). The current implementation effectively uses one segment named `code`. |
| **Segment** | A contiguous block of bytes from a bot, with a start address and a size. The unit of placement in memory. |
| **Relocation** | The process of rewriting absolute addresses in compiled bytes after choosing a base address `M`. Jumps/calls/SPLs get `+M` shifts; symbols get `+M`. |
| **Entry point** | The address where a process begins execution. Default: the address of the `start:` label, falling back to the first byte of the first segment. |
| **DAT bomb** | A data byte (`0xF0`) placed in memory whose execution terminates the executing process. The classic Core War weapon. |
| **SPL** | (split) Spawn a new process for the same bot at a target address. Parent continues. Subject to the global process cap. |
| **Trap** | An author-defined data pattern (e.g., `0xAAAA`) used by the `fortress` bot to mark its defensive positions. Also: a cell that intentionally bombs whoever runs through it. |
| **Carpet bomb** | An attack pattern where an attacker writes DAT (or other terminating bytes) over a *range* of cells, hoping at least one will be executed by the target. |
| **Replicator** | A bot strategy of copying itself to fresh memory and SPL'ing into the copy, so killing one copy leaves others alive. The `vampire` bot is a replicator. |
| **Imp** | A classic Core War warrior consisting of one instruction that copies itself to PC+1 and runs forever. (Not shipped here, but a useful reference.) |
| **BattleSystem** | The orchestrator class that owns the memory, process manager, controller, parser, and code generator for one battle. |
| **BattleController** | The state machine for a battle: pending → running → paused → completed. Owns the score map and execution log. |
| **ProcessManager** | The container/scheduler for processes. |
| **MemorySystem** / **TrackedMemorySystem** | The shared core, with byte storage and (in the tracked subclass) ownership map. |
| **InstructionDecoder** / **ExecutionUnit** | Two CPU components from the prototype. The decoder parses raw bytes into structured instructions; the execution unit applies them. The reference prototype mostly bypasses these in favor of inline switch logic in `BattleSystem.executeInstruction()`. |
| **AssemblyParser** / **CodeGenerator** | The toolchain: parser turns source into tokens + symbols; codegen turns those into bytes + segments. |
| **Tick** | One iteration of the WebSocket auto-step interval (50 ms = 20 Hz in the prototype). One executed instruction per tick when running. |
| **Subscriber** | A WebSocket client that has registered for events about a specific battle (or all battles). |
| **Dashboard** | The right-hand UI panel showing per-bot cards, metrics, and an execution log. |
| **MemoryVisualization** | The left-hand canvas showing every cell colored by ownership, animated by recent writes and execution trails. |
| **BattleClient** | The frontend module that connects to WebSocket and dispatches messages to `Dashboard` and `MemoryVisualization`. |
