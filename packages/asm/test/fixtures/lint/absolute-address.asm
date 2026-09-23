; absolute-address: a memory operand with no register is a fixed place in the core.
%name     "Absolute"
%strategy "Reads and writes through [label] and [disp16]."

start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     ax, [bomb]              ; warns
        mov     word [0x0100], 0        ; warns: a number is a fixed place too
        lea     di, [bomb+2]            ; warns
        add     word [word bomb], 1     ; warns: a pinned displacement is no base
        times   2 inc word [count]      ; warns, once for the line
        call    [vector]                ; warns
        mov     ax, [bx+bomb]           ; fine: bx holds the base
        mov     ax, [si+bomb]           ; fine: an index register
        mov     ax, [bp]                ; fine
        jmp     start

bomb:   dat
count:  dw      0
vector: dw      0
