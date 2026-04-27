# EXEC_1_1_MEMORY: Implementing the Memory System

This playbook provides the granular steps to implement the Memory System as defined in `specs/design/MEMORY_SYSTEM_SPEC.md` and `specs/design/MEMORY_INTERFACE.ts`.

## 🛠 Implementation Steps

- [x] **Step 1: Core Buffer Setup**
    - Create the `MemorySystem` class implementing `IMemorySystem`.
    - Implement the `Uint8Array` storage with configurable size (default 64KB).
    - Implement the `read` and `write` methods with the circular wrapping formula: `((addr % SIZE) + SIZE) % SIZE`.
    - Implemented in `src/core/MemorySystem.ts`
- [x] **Step 2: Protection Layer**
    - Implement the `Set<number>` of protected addresses in `MemorySystem`.
    - Update `write` to check `isProtected()` and log violations without failing the process.
    - Implement `protect()`, `unprotect()`, and `unprotect()`.
    - Implemented in `src/core/MemorySystem.ts`
- [x] **Step 3: Ownership Tracking**
    - Create the `TrackedMemorySystem` class extending `MemorySystem`.
    - Implement the `Uint16Array` ownership map.
    - Implement `setCurrentProcess(pid)` to track the active writer.
    - Override `write` to update `owners[normalized_address] = currentPid` whenever a write occurs.
    - Implement `setOwnershipRange()` for the loader.
    - Implemented in `src/core/TrackedMemorySystem.ts`
- [x] **Step 4: Data Access & Visualization**
    - Implement `getMemory()` and `getOwners()` to return clones (copies) of the buffers.
    - Implement `getOwner(address)`.
    - Implemented in `src/core/MemorySystem.ts` and `src/core/TrackedMemorySystem.ts`
- [x] **Step 5: Verification**
    - Create a test suite that verifies:
        - Circular wrapping (negative and overflow addresses).
        - Ownership updates on write.
        - Protection no-ops for protected cells.
        - Ownership range setting during loading.
        - No OOB errors for any input.
    - Verified via `src/core/tests/memory.test.ts`


## 📋 Verification Checklist
- [x] Memory wraps correctly at 0 and 65535.
- [x] Writing to cell 10 with PID 5 results in `getOwner(10) === 5`.
- [x] Writing to a protected cell does not change the value.
- [x] `getMemory()` returns a copy, not a reference.
