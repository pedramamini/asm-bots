; Labels, statements, and what starts a statement (ISA §6).
start:  call    .here
.here:  pop     bx
        sub     bx, .here
msg     db      1, 2
SIZE    equ     end - start
pad     times   4 nop
loop:   jmp     loop
$ax:    dw      $ax
..@x:   ret
lone:
        rep     movsw
        repne   scasb
        REPZ    CMPSB
        times   SIZE / 2 dw 0
        times   2 rep stosb
        je      start
        SAL     AX, 1
        MOV     AL, [BX+SI]
        foo     ax
end:    hlt
