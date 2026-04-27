# PLAN_1_3_CODEGEN: Byte Encoding & Relocation Design

## 🔍 Analysis & discovery
- [x] Analyze `specs/04-instruction-set.md` to create a master "Opcode $\rightarrow$ Byte Length" mapping table
- [x] Deep dive into the Relocation logic in `specs/02-architecture.md`
- [x] Define the exact binary format for 16-bit values (little-endian verification)
- [x] Design the "Memory Segment" metadata structure needed for the loader

## 📄 Documentation Output
- [x] Produce `specs/design/CODEGEN_SPEC.md`: A complete encoding manual (Instruction $\rightarrow$ Bytes)
- [x] Produce `specs/design/RELOCATION_SPEC.md`: A mathematical proof/description of the relocation formula for jumps/calls/SPL

## 🚀 Playbook Generation
- [x] Produce `playbooks/EXEC_1_3_CODEGEN.md`: A granular, step-by-step execution playbook for implementing the Encoder and Relocator.
