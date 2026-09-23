; Spiral Painter paints 0x55 bytes along a square spiral that starts at its own base, with legs
; of 1, 2, 3, and more cells, each a right turn from the one before.
; A step of +1, +256, -1, or -256 moves one cell right, down, left, or up in the arena's
; 256 x 256 map, and each leg is one cell longer than the one before, so one empty row or column
; stays between two arms and the spiral shows as a square of rings.
; It keeps di as an offset from its base and skips the offsets of its own body, so it never
; paints itself, and after its longest leg, LAST cells, it starts again from the center.

%name     "Spiral Painter"
%author   "ASM Bots"
%strategy "Paint 0x55 in a square spiral around myself"

PAINT   equ     0x55                    ; the byte it paints
ROW     equ     256                     ; a row of the arena: down is +ROW, up is -ROW
LAST    equ     254                     ; the longest leg: the rings then span the core
SIZE    equ     end - start

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here

; Spiral: from the center, legs of 1, 2, 3, ... cells, each a right turn from the one before.
spiral: xor     di, di                  ; di = the offset from our base: the center first
        mov     si, 1                   ; the step of this leg: right
        mov     bp, ROW                 ; the step of the next leg: down
        mov     dx, 1                   ; the length of this leg
.leg:   mov     cx, dx
.step:  add     di, si
        cmp     di, SIZE
        jb      .skip                   ; our own body: leave it as it is
        mov     byte [bx+di], PAINT
.skip:  loop    .step
        xchg    si, bp                  ; turn right: the next step is now this one,
        neg     bp                      ; and the step after it is this one reversed
        inc     dx
        cmp     dx, LAST + 1
        jb      .leg
        jmp     spiral

end:
