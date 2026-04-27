---
type: reference
title: Binary Format and Memory Segment Structure
created: 2026-04-27
tags:
  - binary-format
  - memory-segment
  - loader
---

# Binary Format & Memory Segment Structure

## 1. 16-bit Value Encoding (Little-Endian)

All 16-bit values (addresses, immediate values) are encoded using **little-endian** byte order.

- **Example**: The address `0x1234` is encoded as two bytes: `[0x34, 0x12]`.
- **Encoding logic**:
  - Low byte: `value & 0xFF`
  - High byte: `(value >> 8) & 0xFF`

## 2. Memory Segment Metadata

To support the loader and the `BattleSystem`, each `MemorySegment` must carry the following metadata:

### Structure Definition

```typescript
interface MemorySegment {
  name: string;            // e.g., "code", "data"
  startAddress: number;    // The calculated absolute address after relocation (M + offset)
  length: number;          // Total size in bytes
  data: Uint8Array;        // The actual byte stream of the segment
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
  };
}
```

### Role in Loading

1. **Segment Layout**: The `CodeGenerator` determines the size and content of `data` based on the instructions.
2. **Placement**: The loader calculates `startAddress` based on the random base `M`.
3. **Final Write**: The `BattleSystem` iterates through the segments and writes `data` into the shared memory array at `startAddress`.
