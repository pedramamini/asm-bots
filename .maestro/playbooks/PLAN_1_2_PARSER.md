# PLAN_1_2_PARSER: Assembly Syntax Analysis

## 🔍 Analysis & discovery
- [x] Analyze `specs/04-instruction-set.md` and `specs/05-assembly-language.md` for absolute grammar rules
- [x] Perform a "corpus analysis" of all files in `specs/bots/` to identify every single used instruction, label pattern, and directive
- [x] Document all edge cases in the assembly dialect (e.g., how it handles whitespace, comments, and case sensitivity)
- [x] Map the symbol resolution process: Label $\rightarrow$ Offset $\rightarrow$ Absolute Address

## 📄 Documentation Output
- [x] Produce `specs/design/PARSER_SPEC.md`: A formal grammar specification (tokens, rules, and constraints)
- [x] Produce `specs/design/SYMBOLS_SPEC.md`: A detailed design for the Symbol Table and the Two-Pass resolution process
- [x] Produce `playbooks/EXEC_1_2_PARSER.md`: A granular, step-by-step execution playbook for implementing the Lexer and Parser.
