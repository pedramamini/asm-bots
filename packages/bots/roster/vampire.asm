; Vampire samples the core for code four words at a time, finds the top word of what it hit with
; repe scasw, and bites: it writes 16 jmp fangs over the code there, each an E9 and the rel16 from
; that fang to the pit, which it works out as it goes.
; A process that runs a fang lands in the pit, which spl's it into every free slot of its bot and
; loops forever zeroing the 64 bytes that its bx points to, the home of a house-style bot.
; Held processes use up their bot's turns and slots, so a bitten paper copies less and less, and
; at the end of each scan lap the vampire zeros the pit's loop: a held process dies on its next
; pass, and a bot held whole is dead.
; vs imp.asm, seeds 1..20: 19 W / 1 T / 0 L
; vs dwarf.asm, seeds 1..20: 16 W / 0 T / 4 L

%name     "Vampire"
%author   "ASM Bots"
%strategy "Bite code with jmp fangs, hold the bitten in a pit"

K       equ     16                      ; bytes between sampled words
TOP     equ     17                      ; the top fang is this far above the hit
FANGS   equ     16                      ; fangs in a bite: 48 bytes
SPAN    equ     64                      ; bytes of home a held process zeros
BELOW   equ     4 * K                   ; the scan starts this far under the body
ABOVE   equ     3 * (FANGS - 1) - TOP   ; do not bite this close above the body
SIZE    equ     end - start

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        xor     ax, ax                  ; ax = 0, what repe scasw passes over
        std                             ; the scan goes down
        lea     di, [bx-BELOW]

; Scan: or four words K bytes apart; when one is not zero, find the top word with repe scasw.
scan:   mov     dx, [di]
        or      dx, [di-K]
        or      dx, [di-2*K]
        or      dx, [di-3*K]
        jnz     .look
        sub     di, 4 * K
        jmp     scan
.look:  add     di, 2
        mov     cx, 2 * K
        repe    scasw                   ; stops with di one word under the hit
        lea     dx, [di+BELOW+2]
        sub     dx, bx                  ; dx = hit - (base - BELOW)
        cmp     dx, BELOW + SIZE + ABOVE
        jae     bite
        lea     di, [bx-BELOW]          ; our body, or too near it: the lap is over
        mov     word [bx+pit.hold], 0   ; and so is the pit: its loop is DAT from now on
        jmp     scan

; Bite: FANGS fangs from TOP bytes above the hit down, each E9 and its rel16 to the pit.
bite:   add     di, TOP + 2
        lea     dx, [bx+pit-3]
        sub     dx, di                  ; dx = pit - (fang + 3), the rel16 of the top fang
        mov     cx, FANGS
.fang:  mov     byte [di], 0xE9
        mov     [di+1], dx
        add     dx, 3                   ; the next fang is 3 bytes lower, so 3 bytes farther
        sub     di, 3
        loop    .fang
        jmp     scan

; Pit: a bitten process runs this with its own registers, and writes only zeros, over its home.
pit:    xor     si, si
.hold:  spl     .hold                   ; take every free slot of the bitten bot
        mov     word [bx+si], 0
        add     si, 2
        and     si, SPAN - 1
        jmp     .hold

end:
