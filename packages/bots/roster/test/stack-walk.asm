; Stack Walk pushes cx 256 times, as the loop counts it down from 256 to 1, and then spins.
; sp starts at the base of the bot and push takes 2 from sp before it writes, so the words go
; below the bot, each one under the one before, and the bot itself is not changed.
; The engine tests use it to check that the stack grows down from the base into free core.

%name     "Stack Walk"
%author   "ASM Bots"
%strategy "Push 256 words below myself, then spin"

WORDS   equ     256                     ; words to push: 512 bytes of stack

; Walk: push cx until loop counts it to 0; the first word pushed is WORDS and the last is 1.
start:  mov     cx, WORDS
.push:  push    cx
        loop    .push
        jmp     $                       ; done: spin
