---
type: research
title: Relocation Logic Analysis
created: 2026-04-27
tags:
  - relocation
  - architecture
  - loader
---

# Relocation Logic Analysis

Based on the analysis of `specs/02-architecture.md`, the process of moving a bot's code from a conceptual zero-base to a random absolute address in memory is handled by the `CodeGenerator` and the `BattleSystem`.

## Relocation Process

1. **Encoding & Layout**: 
   - The `CodeGenerator` first encodes the source tokens into a stream of `Instruction` objects.
   - It then layouts these instructions into one or more `MemorySegment` objects. At this stage, all labels (symbols) are resolved relative to the start of the segment (base address 0).

2. **Placement**:
   - The `BattleSystem` picks a random base address `M` in the range `[0, MEMORY_SIZE * 0.8)`.

3. **Relocation**:
   - The `CodeGenerator.relocate(M)` function is called.
   - **Goal**: Update all absolute memory references (Jump targets, Call targets, SPL targets) so they point to the correct absolute address in the actual memory array.
   - **Formula**: `Absolute Address = M + Relative Offset`.
   - Since the segments are packed starting at 0, any symbol at offset `O` becomes `M + O`.

4. **Writing to Memory**:
   - The resulting bytes are then written into the shared memory array starting at address `M`.

## Key Considerations

- **16-bit Addresses**: Memory is treated as a 16-bit address space (0x0000 to 0xFFFF).
- **Little-Endian Encoding**: All 16-bit values (including relocated targets) are stored as `[low_byte, high_byte]`.
- **Consistency**: This ensures that regardless of where a bot is placed, its internal jumps and calls remain valid.
