---
type: report
title: EXEC_1_3_CODEGEN - Implementation Playbook
created: 2026-04-27
tags:
  - playbook
  - implementation
  - codegen
---

# EXEC_1_3_CODEGEN: Implementation Playbook

This playbook provides a granular guide for implementing the `CodeGenerator` and `Relocator` modules.

## 🎯 Goal
Implement the logic to transform tokens/symbols into a binary byte stream and handle absolute address relocation.

## 🛠 Prerequisites
- Review [[CODEGEN_SPEC]] for the encoding table.
- Review [[RELOCATION_SPEC]] for the relocation formula.
- Review [[binary-format]] for little-endian requirements.

## 📋 Execution Steps

### Phase 1: The Encoder
- [ ] **Create `Instruction` class/type**: Define a structure that holds the opcode, operands, and calculated size.
- [ ] **Implement `calculateInstructionSize()`**: Use the mapping from [[CODEGEN_SPEC]] to return the correct byte length for a given opcode.
- [ ] **Implement `encode()`**: 
    - Map mnemonics to opcodes.
    - Encode operands based on the "Operand Encoding" rules in [[CODEGEN_SPEC]].
    - Handle the conversion of scalars to byte streams.
- [ ] **Implement `layout()`**: 
    - Calculate the total size of the binary.
    - Pack `Instruction` objects into a `Uint8Array`.

### Phase 2: The Relocator
- [ ] **Implement `relocate(M)`**: 
    - Take the random base address `M` as input.
    - The `relocate` function should update all jump targets.
    - Ensure the result is applied to the binary bytes in little-endian format.
- [ ] **Verification**: 
    - Create a test bot with a simple jump loop.
    - Relay the bot at three different base addresses $M \in \{0x100, 0x500, 0x2000\}$.
    - Verify that the jump target bytes in the binary are correctly updated to $M + O_{target}$.

## ✅ Completion Criteria
- `CodeGenerator.encode()` produces bytes matching [[CODEGEN_SPEC]].
- `CodeGenerator.relocate()` produces addresses matching [[RELOCATION_SPEC]].
- Unit tests for encoding and relocation pass.
