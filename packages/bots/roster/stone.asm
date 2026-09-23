; Stone runs three processes: two bombers that walk backward with strides of 4 and 11 bytes,
; and a decoy imp that a tiny launcher starts a quarter of the core ahead.
; The stride-11 bomber laps the core in 27,000 cycles and gets to a rival early, and the
; stride-4 bomber follows with a pattern that leaves no instruction of 3 bytes or more whole.
; If bombs or an imp stop both bombers, the decoy keeps the bot alive for a tie, and its long
; trail of non-zero bytes keeps a scanner busy away from the body.
; vs imp.asm, seeds 1..20: 15 W / 5 T / 0 L

%name     "Stone"
%author   "ASM Bots"
%strategy "Two bombers, two strides, one decoy imp"

DENSE   equ     4                       ; the stride of the dense bomber
SPARSE  equ     11                      ; the stride of the fast, sparse bomber
AHEAD   equ     0x4000                  ; the decoy starts a quarter of the core ahead
PAIR    equ     0x90A5                  ; an imp: movsw (A5) then nop (90), as a word
SIZE    equ     end - start
LAPD    equ     (0x10000 - SIZE) / (4 * DENSE) ; passes in a dense lap
LAPS    equ     (0x10000 - SIZE) / (4 * SPARSE) ; passes in a sparse lap

; Setup: the base idiom puts our base address in bx, and ax = 0 is the bomb.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        xor     ax, ax

; Decoy: write an imp AHEAD bytes on and start a process on it, then start the sparse bomber.
; This process goes on as the dense bomber.
decoy:  lea     si, [bx+AHEAD]
        mov     word [si], PAIR
        lea     di, [si+2]
        spl     si                      ; the imp gets these si and di
        spl     sparse

; Dense: each lap starts under our base and walks down, four bombs a pass.
dense:  lea     di, [bx-DENSE]
        mov     cx, LAPD
.bomb:  mov     [di], ax
        mov     [di-DENSE], ax
        mov     [di-2*DENSE], ax
        mov     [di-3*DENSE], ax
        sub     di, 4 * DENSE
        loop    .bomb
        jmp     dense

; Sparse: the same with SPARSE bytes between bombs, so its laps are 2.75 times as fast.
sparse: lea     di, [bx-SPARSE]
        mov     cx, LAPS
.bomb:  mov     [di], ax
        mov     [di-SPARSE], ax
        mov     [di-2*SPARSE], ax
        mov     [di-3*SPARSE], ax
        sub     di, 4 * SPARSE
        loop    .bomb
        jmp     sparse

end:
