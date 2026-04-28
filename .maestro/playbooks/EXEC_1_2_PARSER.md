---
type: reference
title: EXEC_1_2_PARSER
created: 2026-04-27
tags:
  - playbook
  - implementation
  - parser
related:
  - '[[PARSER_SPEC]]'
  - '[[SYMBOLS_SPEC]]'
---

# EXEC_1_2_PARSER: Implementation Playbook

This is the granular execution plan for implementing the Lexer and Parser for the ASM-Bots assembler.

## 🛠 Implementation Steps

### Phase 1: Lexer (Tokenization)
- [x] Implement `tokenize` function.
  - [x] Handle whitespace and comments (`;`).
  - [x] Handle case-insensitivity for instructions and registers.
  - [x] Implement regex for numbers (Decimal, Hex `0x`, Hex `$`).
  - [x] Handle string literals in directives.
  - [x] Implement register alias mapping (e.g., `ax` -> `r0`).
- [x] Create unit tests for the lexer to verify tokenization of various segments.

### Phase 2: Pass 1 (Symbol Calculation)
- [x] Implement the "First Pass" logic.
  - [x] Track `currentAddress` and calculate instruction sizes using the rules in `specs/04-instruction-set.md`.
  - [x] Populate the symbol table with label addresses.
  - [x] Handle `.org` and `equ` directives.
- [x] Create unit tests for the symbol table and address calculation.


### Phase 3: Pass 2 (Emission and Parsing)
- [x] Implement the "Second Pass" logic.
  - [x] Use the symbol table to resolve all label references.
  - [x] Implement the logic to emit a `ParseResult` containing the token stream.
  - [x] Implement the memory access syntax parsing (`[reg]`, `[reg + offset]`, `[addr]`).
- [x] Create unit tests to verify the full source-to-tokens flow.

### Phase 4: Integration and Validation
- [x] {
  - [x] Load a set of existing bots from `specs/bots/`.
  - [x] Pass them through the new parser.
  - [x] Verify that the tokens and resolved symbol addresses match the baseline.
  - [x] Implement the error reporting system (line numbers, error messages).
}
- [x] Finalize documentation and update `CLAUDE.md`.


## 🏁 Completion Criteria
- [x] The parser must be able to process all files in `specs/bots/` without errors.

- [x] The symbol table must correctly resolve all forward and backward references.

- [ ] [x] Grammar rules must align with `specs/04-instruction-set.md` and `specs/05-assembly-language.md`.
