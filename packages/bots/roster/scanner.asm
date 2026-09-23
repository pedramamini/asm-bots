; Scanner looks down the core for non-zero bytes with repe scasb, from just under its own body,
; and carpet-bombs 32 bytes around each one it finds with rep stosw.
; An imp walks up toward it, so the scan meets the imp's newest word first, and the carpet
; starts TOP bytes above that word so that it lands on the imp's next word before the imp runs it.
; It skips hits on its own body and on the bytes where a carpet would reach it, and it scans one
; byte a cycle, so a bomber that is far away has time to find it first.
; vs imp.asm, seeds 1..20: 20 W / 0 T / 0 L

%name     "Scanner"
%author   "ASM Bots"
%strategy "Scan down for code, carpet-bomb what I find"

TOP     equ     18                      ; the carpet starts this far above the hit
WORDS   equ     16                      ; words in a carpet: 32 bytes
BELOW   equ     TOP + 3                 ; skip hits this close under the body
ABOVE   equ     2 * WORDS - 2 - TOP     ; and this close above it
SIZE    equ     end - start

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        xor     ax, ax                  ; al = 0 for the scan, ax = 0 for the bombs
        std                             ; scasb and stosw step down
        lea     di, [bx-BELOW-1]        ; the scan starts under the body

; Scan: pass zero bytes, and bomb the hit unless it is our body or too close to it.
scan:   mov     cx, 0xFFFF              ; more bytes than a scan passes before it meets our body
        repe    scasb                   ; stops with di one byte under the hit
        lea     dx, [di+BELOW+1]
        sub     dx, bx                  ; dx = hit - (base - BELOW)
        cmp     dx, BELOW + SIZE + ABOVE
        jae     bomb
        lea     di, [bx-BELOW-1]        ; our body: scan on from under it
        jmp     scan

; Bomb: 16 words from TOP bytes above the hit down, then scan on from under them.
bomb:   add     di, TOP + 1
        mov     cx, WORDS
        rep     stosw
        jmp     scan

end:
