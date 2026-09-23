; Lines with a lexer or parser error stay exactly as written.
%name     "Errors"
%strategy "Keep what the assembler cannot read."
	mov   ax,   0x   
  jmp FAR [bx]		; far
%define F(x) x+1
foo

msg:   db "unterminated   
   MOV AX , [BX+BP]
        mov     ax, 1
