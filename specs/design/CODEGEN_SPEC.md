---
type: reference
title: CODEGEN_SPEC - Instruction Encoding Manual
created: 2026-04-27
tags:
  - spec
  - encoding
  - binary-format
---

# CODEGEN_SPEC: Instruction Encoding Manual

This document defines the exact byte-level encoding for the ASM Bot language.

## 1. General Layout

Every instruction consists of a 1-byte opcode followed by zero or more operand bytes.

`[Opcode] [Operand 1] [Operand 2] ...`

## 2. Opcode Mapping Table

| Family | Opcode | Mnemonic | Total Size | Operand Layout |
| :--- | :--- | :--- | :--- | :--- |
| **Control** | `0x00` | NOP | 1 | none |
| | `0xFF` | HALT | 1 | none |
| | `0x43` | RET | 1 | none |
| **Arithmetic** | `0x10` | MOV | 3 | `[opcode][op1][op2]` |
| | `0x11` | XCHG | 3 | `[opcode][op1][op2]` |
| | `0x20` | ADD | 3 | `[opcode][op1][op2]` |
| | `0x21` | SUB | 3 | `[opcode][op1][op2]` |
| | `0x22` | MUL | 3 | `[opcode][op1][op2]` |
| | `0x23` | DIV | 3 | `[opcode][op1][op2]` |
| **Logical** | `0x50` | AND | 3 | `[opcode][op1][op2]` |
| | `0x51` | OR | 3 | `[opcode][op1][op2]` |
| | `0x52` | XOR | 3 | `[opcode][op1][op2]` |
| | `0x53` | NOT | 2 | `[opcode][op1]` |
| **Inc/Dec** | `0x60` | INC | 2 | `[opcode][op1]` |
| | `0x61` | DEC | 2 | `[opcode][op1]` |
| **Comparison** | `0x70` | CMP | 3 | `[opcode][op1][op2]` |
| | `0x71` | TEST | 3 | `[opcode][op1][op2]` |
| **Jumps** | `0x30` | JMP | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x31` | JZ | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x32` | JNZ | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x33` | JE | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x34` | JNE | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x35` | JL | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x36` | JG | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x37` | JGE | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0x38` | JLE | 3 | `[opcode][addr_lo][addr_hi]` |
| **Stack** | `0x40` | PUSH | 2 | `[opcode][op1]` |
| | `0x41` | POP | 2 | `[opcode][op1]` |
| | `0x42` | CALL | 3 | `[opcode][addr_lo][addr_hi]` |
| **Special** | `0x43` | RET | 1 | none |
| | `0xA0` | SPL | 3 | `[opcode][addr_lo][addr_hi]` |
| | `0xF0` | DAT | 3 | `[opcode][val_lo][val_hi]` |
| | `0xF1` | DB | 2 | `[opcode][val]` |

## 3. Operand Encoding

### 3.1. Non-Jump Operands (1 byte each)

For arithmetic/logical/memory instructions, operands are encoded as follows:

- **Registers**: `0..3` $\rightarrow$ `r0..r3`
- **Special Registers**: `4=sp`, `5=pc`, `6=flags`
- **Immediate / Memory**: `\ge 7` $\rightarrow$ Literal value or memory reference.

**Memory Reference Encoding (Bit 15 set)**:
If a value is a memory reference, the high bit (0x8000) is set.
- `[reg]` indirect: `0x8000 | reg_code`
- `[reg + offset]` indexed: `0x8000 | (reg_code << 8) | offset`
- `[addr]` direct: `0x8000 | addr` (addr is 15-bit)

## 4. Little-Endian Format

All 16-bit target addresses and immediate values are stored in **little-endian** byte order: `[low_byte, high_byte]`.

See [[binary-format]] for details.
