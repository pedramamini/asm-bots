---
type: reference
title: RELOCATION_SPEC - Relocation Formula & Logic
created: 2026-04-27
tags:
  - spec
  - relocation
  - loader
---

# RELOCATION_SPEC: Relocation Formula & Logic

This document specifies the mathematical and logical process for adjusting absolute memory references in a bot's binary after it has been assigned a base address.

## 1. The Relocation Problem

When a bot is assembled, the `CodeGenerator` layouts the instructions starting from offset 0. All symbol resolutions (labels) are relative to this base.

A jump target `T_{offset}` (e.g., `jmp label_start`) is encoded as an absolute address relative to the start of the code segment.

## 2. Mathematical Formula

Let:
- $M$ be the randomly assigned base address of the bot in global memory.
- $O_{target}$ be the original relative offset of the target label in the binary.
- $A_{absolute}$ be the final absolute address in global memory.

The relocation formula is:
$$A_{absolute} = M + O_{target}$$

## 3. Relocation Process

1. **Encoding**: The `CodeGenerator` encodes the target as a 16-bit relative value.
2. **Placement**: The `BattleSystem` generates a random base $M$.
3. **Execution**: The `CodeGenerator.relocate(M)` function:
    - Scans the binary for all entries marked as "relocatable" (jumps, calls, spl).
    - For each entry, replaces the 2-byte target with the little-endian representation of $M + O_{target}$.

## 4. Boundary Conditions

- **Memory Wrap**: All addresses are treated as $\text{mod } 2^{16}$.
- **16-bit truncation**: If $M + O_{target} > 0xFFFF$, the address wraps around to 0.

## 5. Relation to Loader

This process ensures that regardless of the bot's placement $M$, all internal control flow remains consistent. The final absolute address is used by the `ExecutionUnit` to set the PC.

See [[CODEGEN_SPEC]] for details on the encoding.
