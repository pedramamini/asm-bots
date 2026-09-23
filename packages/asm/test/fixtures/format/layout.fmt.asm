; Layout: case, columns, numbers, and spacing (ARCHITECTURE 4).
%name     "Layout"                      ; metadata text lines up at column 10
%author   "A. K. Dewdney"
%strategy "Every rule of the formatter, once."
SIZE    equ     END - START
loop:   equ     4                       ; a mnemonic as an equ name keeps its colon

START:  mov     ax, 0x1F
.Loop:  add     bx, 0x1F + 0xFF * 0b101 ;tight comment
        mov     word [bx+si+4], -1
        lea     di, [bx-2*(3+1)]        ; tabs become spaces
        mov     byte [bx], ~0x80 & 0xF
        jmp     short $ + 2
        jz      .Loop
        add     ax, strict word 5
        mov     ax, [word 0x0100]
        repz    cmpsb
        times   4 rep movsw

aVeryLongLabelName: nop                 ; a long label pushes the mnemonic

longlabel: mov  ax, (END - START) >> 1
        mov     ax, [bx+si+0x10]        ; the comment of a long line goes one space after the code, here
        ret

msg:    db      "Hi; there", 0x0A, 0
tbl:    dw      1, 2, 3
END:
