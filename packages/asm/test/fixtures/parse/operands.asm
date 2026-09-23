; Every 8086 effective address, with the displacement terms in any order (ISA 6.3).
        mov     ax, [bx+si]
        mov     ax, [bx+di]
        mov     ax, [bp+si]
        mov     ax, [bp+di]
        mov     ax, [si]
        mov     ax, [di]
        mov     ax, [bp]
        mov     ax, [bx]
        mov     ax, [0x0100]
        mov     ax, [si+bx+4]
        mov     ax, [4+di+bp]
        mov     ax, [bx+2*3-1]
        mov     ax, [bx-(2-4)]
        mov     ax, [-2+bx+si]
        mov     ax, [label+bx]
; Sizes: the data size before [, the displacement size inside it, strict on an immediate.
        mov     byte [bx], 1
        mov     [bx], word 0
        add     word [byte bx+0], strict word 5
        mov     ax, [word 0x0100]
        add     ax, strict word 5
        add     bx, strict byte -1
        mov     word ax, 5
        MOV     AL, BYTE [BX]
; Targets for jumps, calls, loops, and spl; registers and memory for the indirect forms.
        jmp     short $
        jmp     near label
        jz      label - 2
        je      $+2
        loopnz  $
        call    0x0103
        call    word [bx]
        jmp     bx
        spl     [bp+si]
        spl     near $ + 0x300
; Prefixes and aliases stay as written, in lowercase.
        REPZ    CMPSB
        repnz   scasw
        sal     ax, 1
label:  ret     4
