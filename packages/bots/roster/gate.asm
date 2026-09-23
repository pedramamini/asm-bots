; Gate runs two processes: a gate that decrements a word 16 bytes under its body on eight turns
; in nine, and a bomber that walks down the core and drops a DAT word every 9 bytes.
; An imp walks up the core, so it reaches the gate before the body, and it runs each word two
; turns after it writes it: a decrement in between makes movsw a movsb, or nop an undefined pop,
; and the imp dies in the gap under the body.
; The bomber is the dwarf's loop unrolled to four bombs a pass, with a wide stride that laps the
; core fast, and an imp that it misses still dies at the gate, so imps and imp rings seldom tie.
; vs imp.asm, seeds 1..20: 20 W / 0 T / 0 L
; vs dwarf.asm, seeds 1..20: 14 W / 0 T / 6 L

%name     "Gate"
%author   "ASM Bots"
%strategy "Stop imps at the gate, bomb the core"

GATE    equ     16                      ; the gate word is this far under the base
STRIDE  equ     9                       ; bytes between bombs, which never land on the gate
PASS    equ     4 * STRIDE              ; bytes a pass covers: four bombs
SIZE    equ     end - start
LAP     equ     (0x10000 - SIZE) / PASS ; passes in a lap: the last bomb lands past the body

; Setup: the base idiom puts our base address in bx, ax = 0 is the bomb, and spl starts the bomber.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        xor     ax, ax
        spl     bomb

; Gate: decrement the gate word on eight turns in nine, forever.
gate:   times   8 dec word [bx-GATE]
        jmp     gate

; Bomb: each lap starts under our base and walks down, four bombs a pass.
bomb:   lea     di, [bx-STRIDE]
        mov     cx, LAP
.bomb:  mov     [di], ax
        mov     [di-STRIDE], ax
        mov     [di-2*STRIDE], ax
        mov     [di-3*STRIDE], ax
        sub     di, PASS
        loop    .bomb
        jmp     bomb

end:
