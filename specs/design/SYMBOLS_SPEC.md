---
type: reference
title: SYMBOLS_SPEC
created: 2026-04-27
tags:
  - symbols
  - relocation
  - linker
related:
  - '[[PARSER_SPEC]]'
---

# SYMBOLS_SPEC: Symbol Table and Resolution

This document details the design for symbol resolution and the two-pass assembly process.

## 1. Symbol Table Structure
The symbol table is a map of identifiers to their resolved values.
- **Key**: String (Label name)
- **Value**: Integer (Address or constant value)

## 2. Two-Pass Resolution Process

### Pass 1: Address Calculation
The assembler performs a linear sweep of the source file to determine the location of every label.
1. **Initialize** `currentAddress = 0` (or `.org` value).
2. **Process Lines**: For each line that contains an instruction or data definition:
   - If a **Label** is encountered: Add `Label -> currentAddress` to the symbol table.
   - If an **Instruction** is encountered: Increment `currentAddress` by the size of that instruction (refer to `specs/04-instruction-set.md`).
   - If a **Data Definition** (`db`, `dw`, `dq`) is encountered: Increment `currentAddress` by total bytes allocated.
   - If a **Directive** (`.org`) is encountered: Update `currentAddress` to the specified value.
3. **Handle Equates**: Process `equ` statements. These do not advance the address pointer but add constants to the symbol table.

### Pass 2: Tokenization and Emission
Using the symbol table populated in Pass 1, the second pass converts source code into a token stream or machine code.
1. **Resolve Symbols**: Every occurrence of a label used as an operand (e.g., `jmp loop`) is replaced by its mapped address from the symbol table.
2. **Emit Tokens**: Generate the `ParseResult` containing the final token stream.
3. **Relocation**: If the bot is relocated to a base address `M`, all absolute addresses in the symbol table and the operand stream are shifted by `M` (`address + M`).

## 3. Symbol Resolution Logic
- **Forward References**: Pass 1 ensures that labels defined later in the file can be resolved in Pass 2.
- **The $ Symbol**: The `$` operator refers to the current value of `currentAddress` during the pass.
- **Entry Point**:
  - If `start:` is defined, its address is the entry point.
  - Otherwise, the first line of valid code is the entry point.
