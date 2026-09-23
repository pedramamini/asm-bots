; Imp, after A. K. Dewdney's MOV 0, 1 (1984), copies the word it is running one word ahead with
; movsw and then runs into the copy.
; Each step is a movsw and a nop, so the copy and the process move one byte a cycle together,
; and a bomb that lands ahead of the imp is written over before the imp gets there.
; Only a bomb on its next word in the two cycles before the imp runs it can kill it, so the imp
; is hard to kill, and since it writes nothing but itself it seldom kills either: imps tie.
; vs imp.asm, seeds 1..20: 0 W / 20 T / 0 L

%name     "Imp"
%author   "ASM Bots"
%strategy "Copy myself one word ahead, forever"

; Setup: the base idiom puts our base address in bx, and si and di frame the first step.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        lea     si, [bx+imp]            ; copy from the word the process runs
        lea     di, [bx+imp+2]          ; to the word after it

; Walk: movsw copies this word 2 bytes on and moves si and di 2 bytes on; nop steps onto it.
imp:    movsw
        nop
