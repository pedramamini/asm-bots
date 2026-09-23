; Silk, after the silk papers of Redcode, starts each copy before it writes it: it puts a jmp $
; pad where the copy will begin, starts a process on the pad with spl, and then writes the body
; over it with rep movsw from the top word down.
; The child spins on the pad while the copy is written, and the last word written is the pad
; itself, so the child runs into a whole copy the moment the copy is done.
; A parent killed in the middle of a copy still leaves its child alive, spinning on the pad, and
; each copy costs more turns than paper's, so silk wins less often than paper and loses less.
; vs imp.asm, seeds 1..20: 16 W / 4 T / 0 L
; vs dwarf.asm, seeds 1..20: 11 W / 9 T / 0 L

%name     "Silk"
%author   "ASM Bots"
%strategy "Start each copy first, then write it"

STEP    equ     0x1234                  ; bytes from one copy to the next along a path
SIZE    equ     end - start
WORDS   equ     (SIZE + 1) / 2          ; words in a copy
TOPW    equ     2 * WORDS - 2           ; where a copy's top word is
PAD     equ     0xFEEB                  ; jmp $ (EB FE), as a little-endian word

; Setup: the base idiom puts our base address in bx, bp starts the path, and copies go down.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     ax, bx
        xchg    al, ah                  ; our base, bytes swapped: far from the parent's path
        mov     bp, ax
        std

; Copy: pad the next place, start a process on the pad, and write the body from the top down.
copy:   add     bp, STEP
        mov     word [bp], PAD
        spl     bp
        lea     si, [bx+TOPW]
        lea     di, [bp+TOPW]
        mov     cx, WORDS
        rep     movsw                   ; the last word lands on the pad
        mov     word [di+STEP/2], 0     ; the occasional bomb
        jmp     copy

end:
