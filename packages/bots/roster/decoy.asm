; Decoy covers the 1 KB under its body and the 1 KB over it with the word A1 00, which reads as
; mov ax, [0xa100] and then a DAT, and then it bombs the core as a dwarf does.
; A scanner stops at non-zero bytes, so the noise costs it a carpet or a bite for each stretch it
; hits, and a process that runs into the noise dies within two instructions.
; The bomber is the dwarf's loop unrolled to four DAT words a pass, 4 bytes apart, and a lap
; counter ends each lap just past the body: the noise gets bombed, and the body never does.
; vs imp.asm, seeds 1..20: 16 W / 4 T / 0 L
; vs dwarf.asm, seeds 1..20: 14 W / 0 T / 6 L

%name     "Decoy"
%author   "ASM Bots"
%strategy "Hide in 2 KB of mov noise, then bomb"

NOISE   equ     1024                    ; bytes of noise on each side
FILL    equ     0x00A1                  ; A1 00: mov ax, [0xa100] and then a DAT
STRIDE  equ     4                       ; bytes between bombs
PASS    equ     4 * STRIDE              ; bytes a pass covers: four bombs
SIZE    equ     end - start
LAP     equ     (0x10000 - SIZE) / PASS ; passes in a lap: the last bomb lands past the body

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here

; Noise: NOISE bytes of FILL under the body and NOISE bytes over it, one word a turn.
noise:  mov     ax, FILL
        lea     di, [bx-NOISE]
        mov     cx, NOISE / 2
        rep     stosw
        lea     di, [bx+end]
        mov     cx, NOISE / 2
        rep     stosw
        xor     ax, ax                  ; ax = 0 is the bomb from here on

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
