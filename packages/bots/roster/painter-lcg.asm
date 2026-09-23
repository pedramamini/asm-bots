; LCG Painter, after RandomWriter1 of ASM Bots v1, paints 0xAA bytes in clouds that drift over
; the core and now and then jump to a new place.
; An LCG in ax (ax = ax * 0x4E6D + 0x3039, the low word of glibc's rand) puts each byte in a
; 32 x 32 square of the arena, the square walks one byte right when the add carries, and when
; the low byte of the random word in dx is zero, about once in 250 writes, the square jumps.
; Over the whole period of the LCG the square walks at most WALK bytes between two jumps, so a
; jump that could bring the cloud onto the painter goes to the far side of the core instead, and
; the painter never paints itself.

%name     "LCG Painter"
%author   "ASM Bots"
%strategy "Scatter 0xAA in drifting clouds that jump now and then"

MULT    equ     0x4E6D                  ; glibc's multiplier, low word (v1's 1103 repeats sooner)
ADDEND  equ     0x3039                  ; glibc's increment, 12345
PAINT   equ     0xAA                    ; the byte it paints
SQUARE  equ     0x1F1F                  ; row and column bits of a place in the square
WALK    equ     208                     ; the most the square walks between two jumps
REACH   equ     WALK + SQUARE + 1       ; bytes from a corner to the last byte it can paint
HALF    equ     0x8000                  ; half the core: how far a jump that could reach us moves
SIZE    equ     end - start

; Setup: the base idiom puts our base address in bx, and our base seeds the LCG.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     si, MULT
        mov     ax, bx
        lea     bp, [bx+SIZE]           ; the first square starts just past our body

; Paint: one step of the LCG, and one byte at a random place in the square.
paint:  mul     si                      ; dx:ax = ax * MULT
        add     ax, ADDEND              ; ax = the next state
        adc     bp, 0                   ; the square walks when the add carries
        mov     di, dx                  ; dx, the high word, is the random word
        and     di, SQUARE
        mov     byte [bp+di], PAINT
        test    dl, dl
        jnz     paint

; Jump: the state is the next corner, unless a cloud there could reach our body.
jump:   mov     bp, ax
        lea     di, [bx+SIZE-1]
        sub     di, bp                  ; di = the last byte of our body - the corner
        cmp     di, REACH + SIZE - 1
        jae     paint
        add     bp, HALF
        jmp     paint

end:
