# Bot Language Specification

## Overview

The ASM-Bots assembly language is an x86-inspired assembly language designed for Core Wars bot programming. It provides a balance between power and simplicity, with safety measures to prevent system abuse.

## Syntax

### Program Structure
```assembly
; Bot metadata
.name "MyBot"           ; Bot name
.author "Developer"     ; Bot author
.version "1.0"         ; Bot version
.strategy "Aggressive" ; Bot strategy description

; Program sections
.code                  ; Start of code section
.data                  ; Start of data section
.const                 ; Start of constant section
```

### Labels and References
```assembly
start:                 ; Code label
    jmp start         ; Reference to label
data_start:           ; Data label
    dw 0x100          ; Data word
```

### Directives
```assembly
.org 0x100            ; Set origin address
.align 2              ; Align to word boundary
.space 16             ; Reserve space
.include "lib.inc"    ; Include file
```

### Data Definitions
```assembly
db 0x42               ; Define byte
dw 0x1234             ; Define word
string: db "Hello"    ; Define string
array: dw 1,2,3,4     ; Define array
```

## Instruction Set

### Data Movement
```assembly
MOV   dest, src       ; Move data
XCHG  op1, op2        ; Exchange data
PUSH  src            ; Push to stack
POP   dest           ; Pop from stack
LEA   dest, [addr]    ; Load effective address
```

### Arithmetic Operations
```assembly
ADD   dest, src       ; Addition
SUB   dest, src       ; Subtraction
MUL   src            ; Multiplication
DIV   src            ; Division
INC   dest           ; Increment
DEC   dest           ; Decrement
NEG   dest           ; Negate
```

### Logical Operations
```assembly
AND   dest, src       ; Logical AND
OR    dest, src       ; Logical OR
XOR   dest, src       ; Logical XOR
NOT   dest           ; Logical NOT
TEST  op1, op2        ; Test bits
```

### Control Flow
```assembly
JMP   target          ; Unconditional jump
JZ    target          ; Jump if zero
JNZ   target          ; Jump if not zero
JG    target          ; Jump if greater
JL    target          ; Jump if less
CALL  target          ; Call subroutine
RET                  ; Return from subroutine
```

### Special Instructions
```assembly
NOP                  ; No operation
HLT                  ; Halt execution
SPL   target         ; Split process
DAT   value          ; Data statement
```

## Registers

### General Purpose
- AX: Primary accumulator
- BX: Base register
- CX: Counter register
- DX: Data register

### Special Purpose
- IP: Instruction pointer
- SP: Stack pointer
- FL: Flags register

### Flag Bits
- Z: Zero flag
- S: Sign flag
- O: Overflow flag
- C: Carry flag

## Memory Model

### Addressing Modes
```assembly
MOV AX, [0x100]      ; Direct
MOV AX, [BX]         ; Indirect
MOV AX, [BX + 0x10]  ; Indexed
MOV AX, [BX + CX]    ; Base + Index
```

### Memory Segments
```assembly
.code                 ; Code segment
    org 0x100        ; Start at 0x100
    mov ax, bx       ; Instructions

.data                 ; Data segment
    org 0x500        ; Start at 0x500
    dw 0x1234        ; Data

.stack                ; Stack segment
    org 0xF00        ; Start at 0xF00
    space 256        ; Reserve space
```

## Compiler Directives

### Conditional Assembly
```assembly
#if VERSION > 1
    mov ax, 0x200
#else
    mov ax, 0x100
#endif

#ifdef DEBUG
    call debug_routine
#endif
```

### Macros
```assembly
#macro LOAD_CONST reg, value
    mov reg, value
#endm

; Usage
LOAD_CONST ax, 0x100
```

## Error Handling

### Runtime Errors
1. Invalid instruction
2. Memory access violation
3. Division by zero
4. Stack overflow

### Compiler Errors
1. Syntax error
2. Undefined symbol
3. Invalid addressing mode
4. Out of range value

## Best Practices

### Code Organization
1. Clear section separation
2. Consistent naming conventions
3. Proper commenting
4. Modular design

### Optimization
1. Minimize memory access
2. Use efficient instructions
3. Avoid redundant operations
4. Consider execution cycles

### Security
1. Validate memory access
2. Check array bounds
3. Handle edge cases
4. Protect critical code

## Example Programs

### Simple Scanner
```assembly
.name "Scanner"
.version "1.0"

.code
start:
    mov  bx, 0x100    ; Start address
scan:
    cmp  [bx], 0      ; Check memory
    jz   next         ; Skip if empty
    call attack       ; Attack if found
next:
    add  bx, 2        ; Next address
    jmp  scan         ; Continue scanning

attack:
    mov  [bx], dat    ; Overwrite target
    ret

dat: dw 0xFFFF        ; Attack pattern
```

### Replicator
```assembly
.name "Replicator"
.version "1.0"

.code
start:
    lea  bx, [code_start] ; Load code address
    mov  cx, code_size    ; Load code size
    call find_space       ; Find empty space
    call copy_code        ; Copy self
    spl  ax              ; Start copy
    jmp  start           ; Continue

find_space:
    ; Space finding logic
    ret

copy_code:
    ; Code copying logic
    ret

code_start:
    ; Mark start of copyable code
code_size equ $ - code_start