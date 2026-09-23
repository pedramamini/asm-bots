; Count adds 1 to ax until ax is 100, and then spins with jmp $.
; A pass of the loop is three instructions and each instruction is one cycle, so ax is 100
; after 298 cycles and stays 100.
; The engine tests use it to check registers, flags, and a conditional jump over many cycles.

%name     "Count"
%author   "ASM Bots"
%strategy "Count ax up to 100, then spin"

GOAL    equ     100                     ; where the count stops

; Count: ax starts at 0, as every register does but ip, sp, and flags.
start:  inc     ax
        cmp     ax, GOAL
        jb      start
        jmp     $                       ; done: spin
