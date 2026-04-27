---
type: research
title: Opcode to Byte Length Mapping
created: 2026-04-27
tags:
  - opcode
  - encoding
  - architecture
---

# Opcode to Byte Length Mapping

Based on the analysis of `specs/04-instruction-set.md`, the following mapping defines the binary length of each instruction.

## Summary Table

| Opcode | Mnemonic | Length (Bytes) | Operand Details |
| :--- | :--- | :--- | :--- |
| `0x00` | NOP | 1 | none |
| `0xFF` | HALT | 1 | none |
| `0x43` | RET | 1 | none |
| `0x10` | MOV | 3 | `[opcode][op1][op2]` |
| `0x11` | XCHG | 3 | `[opcode][op1][op2]` |
| `0x20` | ADD | 3 | `[opcode][op1][op2]` |
| `0x21` | SUB | 3 | `[opcode][op1][op2]` |
| `0x22` | MUL | 3 | `[opcode][op1][op2]` |
| `0x23` | DIV | 3 | `[opcode][op1][op2]` |
| `0x50` | AND | 3 | `[opcode][op1][op2]` |
| `0x51` | OR | 3 | `[opcode][op1][op2]` |
| `0x52` | XOR | 3 | `[opcode][op1][op2]` |
| `0x53` | NOT | 2 | `[opcode][op]` |
| `0x60` | INC | 2 | `[opcode][op]` |
| `0x61` | DEC | 2 | `[opcode][op]` |
| `0x40` | PUSH | 2 | `[opcode][op]` |
| `0x41` | POP | 2 | `[opcode][op]` |
| `0x30` | JMP | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x31` | JZ | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x32` | JNZ | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x33` | JE | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x34` | JNE | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x35` | JL | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x36` | JG | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x37` | JGE | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x38` | JLE | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x42` | CALL | 3 | `[opcode][addr_lo][addr_hi]` |
| `0xA0` | SPL | 3 | `[opcode][addr_lo][addr_hi]` |
| `0x70` | CMP | 3 | `[opcode][op1][op2]` |
| `0x71` | TEST | 3 | `[opcode][op1][op2]` |
| `0x80` | LEA | 3 | `[opcode][op1][op2]` |
| `0x90` | LOAD | 3 | `[opcode][op1][op2]` |
| `0x91` | STORE | 3 | `[opcode][op1][op2]` |
| `0xF0` | DAT | 3 | `[opcode][val_lo][val_hi]` (Data word) |
| `0xF1` | DB | 2 | `[opcode][val]` (Data byte) |

## Analysis Notes

- **1-Byte Instructions**: NOP, HALT, RET.
- **2-Byte Instructions**: NOT, INC, DEC, PUSH, POP, and DB.
- **3-Byte Instructions**: Most arithmetic, logical, memory, and all jump/call/spl instructions.
- **Data Definitions**: 
    - `DAT` (0xF0) is treated as a 16-bit word (3 bytes total).
    - `DB` (0xF1) is treated as a single byte (2 bytes total).
- **Target addresses**: All jumps and calls use 16-bit little-endian targets.
