; Imp Ring writes an imp (movsw, nop) a third of the core ahead and two thirds ahead, starts a
; process on each with spl, and then walks as the third imp itself.
; Each imp copies itself, not the next imp as in a Redcode ring, so a bomb that kills one imp
; leaves two walking, and the bot lives until all three are hit.
; The three processes share the bot's turn, so each imp moves a byte every three cycles: the
; ring trades speed for spares, and like the imp it ties far more often than it kills.
; vs imp.asm, seeds 1..20: 0 W / 20 T / 0 L

%name     "Imp Ring"
%author   "ASM Bots"
%strategy "Three imps a third of the core apart"

THIRD   equ     21846                   ; a third of the core, rounded to an even number
PAIR    equ     0x90A5                  ; movsw (A5) then nop (90), as a little-endian word

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        lea     si, [bx+imp]            ; si steps from our imp to each launch point
        mov     cx, 2                   ; two imps to launch

; Launch: write an imp THIRD bytes on, aim its copy at the next word, and start a process there.
launch: add     si, THIRD
        mov     word [si], PAIR
        lea     di, [si+2]
        spl     si                      ; the child gets these si and di
        loop    launch
        lea     si, [bx+imp]            ; this process walks from our own imp
        lea     di, [bx+imp+2]

; Walk: the imp step, as in imp.asm.
imp:    movsw
        nop
