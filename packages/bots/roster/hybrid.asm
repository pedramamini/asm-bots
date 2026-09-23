; Hybrid scans down the core and carpet-bombs what it finds, as the scanner does, and it keeps a
; guard of 16 bytes of 0xFF 768 bytes over its body as part of its home.
; A bot cannot read who owns a byte, so every 128 bytes of scan it counts the non-zero bytes of
; the guard with repne scasb, which stops at a zero: a bomb in the guard means that a bomber
; walking down the core is 768 bytes from the body.
; Then it turns to paper: its last section copies itself around the core and starts every copy,
; so the body that the bomber is about to hit no longer matters.
; vs imp.asm, seeds 1..20: 19 W / 1 T / 0 L
; vs dwarf.asm, seeds 1..20: 17 W / 3 T / 0 L

%name     "Hybrid"
%author   "ASM Bots"
%strategy "Scan and carpet-bomb; turn to paper when bombs land near home"

TOP     equ     20                      ; the carpet starts this far above the hit
WORDS   equ     16                      ; words in a carpet: 32 bytes
CHUNK   equ     128                     ; bytes of scan between guard checks
AWAY    equ     768                     ; the guard starts this far over the body
GUARD   equ     16                      ; bytes in the guard
FILL    equ     0xFFFF                  ; what the guard holds
STEP    equ     0x1234                  ; bytes from one copy to the next along a path
BELOW   equ     TOP + 3                 ; skip hits this close under the body
ABOVE   equ     AWAY + GUARD + 2 * WORDS ; and this close over it, the guard and all
SIZE    equ     end - start
PWORDS  equ     (end - paper + 1) / 2   ; words in a copy: the paper section only

; Setup: the base idiom puts our base address in bx; lay the guard, then aim the scan down.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     ax, FILL
        lea     di, [bx+end+AWAY]
        mov     cx, GUARD / 2
        rep     stosw
        xor     ax, ax                  ; al = 0 for the scan, ax = 0 for the bombs
        std                             ; scasb and stosw step down
        lea     di, [bx-BELOW-1]

; Scan: CHUNK bytes at a time, and bomb a hit unless it is our body or our guard.
scan:   mov     cx, CHUNK
        repe    scasb                   ; stops with di one byte under the hit
        je      check                   ; CHUNK zero bytes: time to check the guard
        lea     dx, [di+BELOW+1]
        sub     dx, bx                  ; dx = hit - (base - BELOW)
        cmp     dx, BELOW + SIZE + ABOVE
        jae     bomb
        lea     di, [bx-BELOW-1]        ; our body or guard: scan on from under the body
        jmp     scan

; Bomb: WORDS words from TOP bytes above the hit down.
bomb:   add     di, TOP + 1
        mov     cx, WORDS
        rep     stosw

; Check: repne scasb passes the guard's non-zero bytes and stops at the first zero, if any.
check:  mov     bp, di                  ; bp keeps the scan's place
        lea     di, [bx+end+AWAY+GUARD-1]
        mov     cx, GUARD
        repne   scasb
        je      paper                   ; a zero in the guard: turn to paper
        mov     di, bp
        jmp     scan

; Paper: a copy holds this section only and starts here, so bx is where its base would be.
paper:  call    .here
.here:  pop     bx
        sub     bx, .here
        cld                             ; copies go up
        mov     dx, bx
        xchg    dl, dh                  ; bytes swapped: far from the parent's path
.copy:  add     dx, STEP
        lea     si, [bx+paper]
        mov     di, dx
        mov     cx, PWORDS
        rep     movsw
        spl     dx
        mov     word [di+STEP/2], 0     ; the occasional bomb
        jmp     .copy

end:
