        mov     ax, bx + 1
        mov     ax, (bx)
        mov     ax, "ab"
        dw      "ab"
        db      "ab" + 1
        mov     ax, short 5
        jmp     short bx
        jmp     near [bx]
        jmp     word label
        jmp     word short 5
        mov     byte ax, 5
        mov     word al, 5
        mov     strict word [bx], 5
        mov     strict word ax, 5
        jmp     strict word 5
        times   bx nop
size    equ     si
