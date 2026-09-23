; Dwarf, after A. K. Dewdney's Dwarf (1984), walks backward through the core and drops a DAT
; word every 4 bytes, one bomb for each three instructions.
; The core is a multiple of 4 bytes long, so a whole lap would bomb the dwarf itself: a lap
; counter ends each lap just past its body and starts the next lap from its base again.
; Any process that runs into a bomb dies, and an imp that walks toward the dwarf dies if a bomb
; lands on its next word as the two pass each other.
; vs imp.asm, seeds 1..20: 14 W / 6 T / 0 L

%name     "Dwarf"
%author   "ASM Bots"
%strategy "Bomb every 4th byte, walking backward"

STRIDE  equ     4                       ; bytes between bombs
SIZE    equ     end - start
LAP     equ     (0x10000 - SIZE) / STRIDE ; bombs in a lap: the last one lands past the body

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here

; Bomb: each lap starts at our base and walks down, one DAT word every STRIDE bytes.
lap:    mov     di, bx
        mov     cx, LAP
.bomb:  sub     di, STRIDE
        mov     word [di], 0
        loop    .bomb                   ; the jmp back, counting the lap down
        jmp     lap

end:
