

; Blank lines and comments: one blank line between global-label blocks.



%name "Blocks"
%strategy "Blank lines between blocks, and none elsewhere."
	org 0
start:  call .here
.here:  pop bx
        sub bx, .here            ; bx = base
                                 ; (the base idiom)
  ; an indented comment goes to column 8
; the loop below
loop1:  add di, 4
.again: mov word [di], 0


        jmp .again
; one-line blocks stay together
bomb:   dat
ptr:    dw 0
count:  dw 0
alias:
main:   nop
        jmp main



