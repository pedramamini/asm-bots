; Rep Copy copies 256 words from its base to a place 4 KB on with one rep movsw, then spins.
; A rep movsw copies one word a turn and leaves ip on its prefix until cx is 0, so the copy
; takes 256 cycles, and only then does ip go past it to the jmp $.
; The engine tests use it to check the timing of rep: 256 turns on the prefix, then the next
; instruction.

%name     "Rep Copy"
%author   "ASM Bots"
%strategy "Copy 512 bytes with one rep movsw, then spin"

WORDS   equ     0x100                   ; words to copy
AWAY    equ     0x1000                  ; the copy starts this far past our base

; Setup: the base idiom puts our base address in bx, and si, di, and cx frame the copy.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     si, bx                  ; from our base
        lea     di, [bx+AWAY]           ; to AWAY bytes on
        mov     cx, WORDS
        cld                             ; up: flags start with DF clear, and this says so

; Copy: one instruction, 256 cycles.
copy:   rep     movsw
        jmp     $                       ; done: spin
