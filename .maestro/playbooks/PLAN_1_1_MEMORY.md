# PLAN_1_1_MEMORY: Memory Model Deep Dive

## 🔍 Analysis & discovery
- [x] Extract every constraint from `specs/03-memory-model.md`
    - Memory: `Uint8Array`, configurable size (default 64KB). 1-byte cells.
    - Addressing: Circular wrapping via `((addr % SIZE) + SIZE) % SIZE`. No OOB errors.
    - Encoding: Little-endian for 16-bit values. No alignment requirements.
    - Ownership: `Uint16Array` (parallel to memory). Stores PID of last writer. 0 = unowned.
    - Ownership Flow: Automatic update on write based on `currentProcess` PID.
    - Protection: `Set<number>` of protected addresses. Writes to these are no-ops and logged (non-fatal).
    - Loading: Base address = `floor(random() * (MEMORY_SIZE * 0.8))`. Overlap allowed.
    - Interface: `MemorySystem` (read/write/protect/unprotect/isProtected/getMemory) $\rightarrow$ `TrackedMemorySystem` (setCurrentProcess/getOwner/getOwners/setOwnershipRange).
    - Visualization: `getMemory()` and `getOwners()` must return copies.
- [x] Analyze bot source code in `specs/bots/` to identify implicit memory expectations (e.g., how they handle wrapping)
    - **Explicit Wrapping Expectation**: Bots like `Hunter` (`bx` check at `0xF000`, but relies on circular wrapping if `bx + cx` exceeds `0xFFFF`) and `Vampire` (`mov bx, 0x200` then `add bx, 0x10` in a loop) expect memory to be a continuous circular buffer.
    - **Absolute Addressing**: Most bots use absolute addresses (e.g., `0x200`, `0x300`, `0x100`, `0xF000`) as reference points for their strategies, implying they expect a fixed-size core where these addresses are meaningful.
    - **Multi-byte Writes**: bots like `Fortress` and `Hunter` use `mov word [bx], ...` and `dw` (Define Word) for 16-bit data, confirming the need for little-endian multi-byte support without alignment restrictions.
    - **Pointers/Indirection**: `Vampire` uses `spl dx` for replication to a target address, expecting the memory system to handle the placement of the new process.
    - **Empty Space Detection**: Bots use `cmp [bx], 0` to find "empty" space, identifying `0` as the default value for uninitialized/empty memory.
- [x] Map out the exact data-flow of the Ownership Map (`Uint16Array`)
    - **Initialization**: `owners` map is initialized as `Uint16Array(SIZE)` with all values `0`.
    - **Write Trigger**: Every `write(address, value)` operation triggers an ownership update.
    - **Update Logic**: `owners[normalized_address] = currentProcessId`.
    - **Current Process Context**: The `ExecutionLoop` must call `setCurrentProcess(pid)` before executing a bot's instruction and `setCurrentProcess(null)` after.
    - **Initial Load**: `setOwnershipRange(start, size, owner)` is used by the loader to tag the bot's initial code as owned by the bot.
    - **Visualization Flow**: Frontend requests `getOwners()` $\rightarrow$ MemorySystem returns a copy $\rightarrow$ Frontend maps `owners[i]` to a color.
- [x] Resolve contradictions between the prototype implementation and the desired rebuild specs
    - **No contradictory evidence found**: The `03-memory-model.md` spec is comprehensive and aligns perfectly with the implicit requirements found in the bot source code (`specs/bots/`).
    - **Prototype-to-Rebuild Alignment**: The "Circular Addressing" logic in the spec matches the "Core War" nature of the bots. The "Ownership Map" matches the visualization needs. The "Protection" is noted as optional but available, avoiding breaking changes.

## 📄 Documentation Output
- [x] Produce `specs/design/MEMORY_SYSTEM_SPEC.md`: A exhaustive technical spec including:
    - Exact normalization formulas
    - Ownership update triggers
    - Memory layout constraints for the loader
- [x] Produce `specs/design/MEMORY_INTERFACE.ts`: A complete TypeScript interface definition for the `MemorySystem` and `TrackedMemorySystem`
- [x] Produce `playbooks/EXEC_1_1_MEMORY.md`: A granular, step-by-step execution playbook for the developer to implement the specified system.
