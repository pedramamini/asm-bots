---
type: reference
title: PARSER_SPEC
created: 2026-04-27
tags:
  - parser
  - assembly
  - grammar
related:
  - '[[SYMBOLS_SPEC]]'
---

# PARSER_SPEC: Assembly Grammar Specification

This document defines the formal grammar for the ASM-Bots assembly dialect.

## 1. Lexical Analysis (Tokens)

### 1.1 Tokens
- **Instruction**: Mnemonics from the approved set (e.g., `mov`, `add`, `jmp`). Case-insensitive.
- **Label**: Identifiers used as jump targets or data markers. Case-sensitive. Format: `[A-Za-z_][A-Za-z0-9_]*`.
- **Register**: Canonical names (`r0`-`r3`, `sp`, `pc`, `flags`) and x86 aliases (`ax`, `bx`, `cx`, `dx`, `si`, `di`). Case-insensitive.
- **Immediate**:
  - Decimal: `123`, `-7`
  - Hexadecimal: `0x1234` or `$1234`.
- **String Literal**: Double-quoted strings used only in metadata directives (e.g., `.name "Hunter"`).
- **Directive**: Keywords starting with `.` (e.g., `.name`, `.code`, `.org`). Case-insensitive.
- **Symbol**: References to defined labels or constants (e.g., `jmp loop`).
- **Punctuation/Separators**:
  - Comma (`,`): Separates operands. Interchangeable with whitespace.
  - Semicolon (`;`): Starts a comment running to the end of the line.
  - Colon (`:`): Follows a label definition (e.g., `start:`).
  - Brackets (`[` and `]`): Define memory access (e.g., `[bx + 16]`).
  - Equate (`equ`): Defines a constant.

### 1.2 Lexical Rules
- **Case Sensitivity**:
  - Instructions, Registers, Directives: **Case-insensitive**.
  - Labels: **Case-sensitive**.
- **Whitespace**: Insignificant except as a token separator. Tabs and spaces are equivalent.
- **Comments**: Everything from `;` to the end of the line is ignored.

## 2. Grammar Rules

### 2.1 File Structure
A source file consists of a sequence of lines. Each line may contain:
- Comments (ignored)
- Blank lines (ignored)
- Metadata Directives (can appear anywhere, usually at the top)
- Section Directives (set the current mode to `.code`, `.data`, or `.const`)
- Label Definitions (optional, prefixing an instruction or data definition)
- Instructions or Data Definitions

### 2.2 Instruction Syntax
`[Label:] Instruction [Operand1, Operand2, ...]`

- **Instructions**: Must use approved mnemonics.
- **Operands**:
  - Registers, Immediates, or Symbols.
  - Memory Access: `[reg]`, `[reg + offset]`, `[addr]`.
  - The `word` modifier (e.g., `mov word [bx], trap`) is accepted but treated as a no-op.

### 2.3 Data Definitions
- `db <value(s)>`: Define byte(s). Supports comma-separated lists.
- `dw <value(s)>`: Define word(s) (16-bit, little-endian). Supports comma-separated lists.
- `dq <value(s)>`: Define quad(s) (32-bit). Accepted for compatibility, but limited support in codegen.

### 2.4 Directives
- **Metadata**: `.name`, `.author`, `.version`, `.strategy`
- **Section**: `.code`, `.data`, `.const`
- **Origin/Alignment**: `.org N`, `.align N`, `.space N`
- **Inclusion**: `.include "file"`

### 2.5 Equates
`Symbol equ Expression`
- `Expression` can be a literal or a formula using `$` (current address) and other symbols.
- `equ` does not allocate memory.

## 3. Constraints
- **Entry Point**: The first line of code is the entry point, unless a `start:` label is defined.
- **Instruction Set**: Only instructions listed in `specs/04-instruction-set.md` are permitted.
- **Addressing**: Only direct, indirect, and indexed (`reg + offset`) memory access is supported.
