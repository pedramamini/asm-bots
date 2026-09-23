section .text
segment code
global start
extern foo
%macro bomb 1
%endmacro
%if 1
%ifdef DEBUG
%else
%endif
%include "lib.asm"
%rep 4
%assign x 1
        incbin  "bot.bin"
        jmp     far [bx]
        jmp     0x1234:0x5678
        mov     ax, es
        mov     ax, [es:bx]
        push    cs
        mov     eax, 1
        mov     ax, dword [bx]
        dd      5
        lock    inc word [bx]
[bits 16]
