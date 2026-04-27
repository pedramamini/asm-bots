---
type: reference
title: Memory System Technical Specification
created: 2026-04-27
tags:
  - memory
  - architecture
  - core-war
related:
  - '[[MEMORY_INTERFACE]]'
---

# Memory System Technical Specification

This document defines the exhaustive technical requirements for the ASM Bots memory system.

## 1. Core Storage
- **Primary Store**: A `Uint8Array` of configurable size.
- **Default Size**: 65536 bytes (64 KB).
- **Cell Width**: 1 byte.
- **Encoding**: Little-endian for all 16-bit values (e.g., `[low_byte, high_byte]`).
- **Alignment**: No alignment requirements. Reads and writes can occur at any byte boundary.

## 2. Addressing Model
### 2.1 Circular Wrapping
Every memory access (fetch, load, store, stack) must be normalized using the following formula:

`address_eff = ((address % SIZE) + SIZE) % SIZE`

This ensures that negative addresses wrap to the end of memory and overflow addresses wrap to the beginning. There are no Out-of-Bounds (OOB) errors.

### 2.2 Load Policy
- **Base Address**: Randomly assigned as `floor(random() * (MEMORY_SIZE * 0.8))`.
- **Overlap**: Bot overlaps are permitted.

## 3. Ownership System
### 3.1 Ownership Map
- **Structure**: A `Uint16Array` of identical length to the primary `Uint8Array`.
- **Value**: Stores the Process ID (PID) of the last process to write to that cell.
- **Unowned State**: A value of `0` indicates the cell is unowned.

### 3.2 Ownership Data-Flow
1. **Context Setting**: The execution engine must set the current active PID via `setCurrentProcess(pid)`.
2. **Write Operation**: Whenever `write(address, value)` is called, the system automatically updates the ownership map:
   `owners[normalized_address] = currentProcessId`.
3. **Initial Loading**: The loader uses `setOwnershipRange(start, size, owner)` to tag the initial bot binary.
4. **Visualization**: The system provides a copy of the ownership map for frontend colorization.

## 4. Protection Mechanism
- **Mechanism**: A `Set<number>` containing protected addresses.
- **Behavior**: 
  - Writes to a protected address are **no-ops** (the value is not changed).
  - The attempt is logged as a violation in the `accessLog`.
  - Protected writes are **non-fatal**; the process is NOT killed.
- **Scope**: Optional in v1, but the interface must support `protect()`, `unprotect()`, and `isProtected()`.

## 5. Performance & API Constraints
- **Copies vs References**: `getMemory()` and `getOwners()` must return copies of the internal buffers to prevent external mutation of the core state.
- **Logging**: Maintain an `accessLog` for protection and boundary events.
