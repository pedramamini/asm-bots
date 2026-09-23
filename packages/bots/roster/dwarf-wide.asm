; Dwarf Wide walks backward through the core and drops a DAT word every 3 bytes, so two bytes
; in three are zero and no instruction of 2 bytes or more is left whole.
; Its loop is unrolled: four stores at fixed offsets from di and one sub make a bomb every
; 1.5 cycles, twice the dwarf's pace, and a lap counter ends each lap just past its body.
; A process that runs into the bombs dies, or runs the bytes between them out of step with its
; own code, and an imp dies if a bomb lands on its next word as the two pass each other.
; vs imp.asm, seeds 1..20: 16 W / 4 T / 0 L

%name     "Dwarf Wide"
%author   "ASM Bots"
%strategy "Bomb every 3rd byte, four bombs a pass"

STRIDE  equ     3                       ; bytes between bombs
PASS    equ     4 * STRIDE              ; bytes a pass covers: four bombs
SIZE    equ     end - start
LAP     equ     (0x10000 - SIZE) / PASS ; passes in a lap: the last bomb lands past the body

; Setup: the base idiom puts our base address in bx, and ax = 0 is the bomb.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        xor     ax, ax

; Bomb: each lap starts under our base and walks down, four bombs a pass.
lap:    lea     di, [bx-STRIDE]
        mov     cx, LAP
.bomb:  mov     [di], ax
        mov     [di-STRIDE], ax
        mov     [di-2*STRIDE], ax
        mov     [di-3*STRIDE], ax
        sub     di, PASS
        loop    .bomb
        jmp     lap

end:
