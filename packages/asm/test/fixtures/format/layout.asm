; Layout: case, columns, numbers, and spacing (ARCHITECTURE 4).
%NAME "Layout"   ; metadata text lines up at column 10
   %Author   "A. K. Dewdney"
%strategy	"Every rule of the formatter, once."
SIZE EQU END-START
loop: equ 4                   ; a mnemonic as an equ name keeps its colon
START:MOV AX,0X1f
  .Loop:   Add   BX , 1Fh+0ffh*0B101 ;tight comment
	mov	word [ BX + SI + 4 ] , -1
	lea di,[bx - 2*(3+ 1)]		; tabs become spaces
        MOV byte[bx],~0x80 & 0FH
jmp SHORT $+2
	jz   .Loop
        add ax, strict WORD 5
        mov ax, [WORD 0x0100]
  REPZ CMPSB
	times 4 rep   Movsw
aVeryLongLabelName: nop           ; a long label pushes the mnemonic
longlabel: mov ax, ( END - START ) >> 1
        mov ax, [bx+si+0x10] ; the comment of a long line goes one space after the code, here
        ret
msg db "Hi; there", 0x0a, 0
tbl DW 1,2 ,  3
END:
