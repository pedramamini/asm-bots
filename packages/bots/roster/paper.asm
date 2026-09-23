; Paper copies its body with rep movsw to a place 0x1234 bytes along its path, starts a process
; in the copy with spl, drops a DAT bomb halfway to the next place, and goes on to the next.
; Each copy starts its own path at its base with the two bytes swapped, so a parent and its child
; land in different places, and the processes spread over the whole core up to the process cap.
; From then on every copy writes 34 bytes of paper over whatever it lands on: a bomber or a
; scanner loses its code faster than it can find 64 processes in 64 places, and seldom wins.
; vs imp.asm, seeds 1..20: 14 W / 6 T / 0 L
; vs dwarf.asm, seeds 1..20: 14 W / 6 T / 0 L

%name     "Paper"
%author   "ASM Bots"
%strategy "Copy myself all over the core and start every copy"

STEP    equ     0x1234                  ; bytes from one copy to the next along a path
SIZE    equ     end - start
WORDS   equ     (SIZE + 1) / 2          ; words in a copy

; Setup: the base idiom puts our base address in bx, and dx starts the path.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     dx, bx
        xchg    dl, dh                  ; our base, bytes swapped: far from the parent's path

; Copy: write the body STEP bytes on, start a process there, and bomb halfway to the next place.
copy:   add     dx, STEP
        mov     si, bx
        mov     di, dx
        mov     cx, WORDS
        rep     movsw
        spl     dx
        mov     word [di+STEP/2], 0     ; the occasional bomb
        jmp     copy

end:
