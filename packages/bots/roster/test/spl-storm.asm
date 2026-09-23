; SPL Storm starts a child at its first instruction with spl, jumps back, and does it again.
; Every process runs the same two instructions, so about half the turns of the bot start a new
; process, and after 101 cycles it has as many as the process cap allows.
; The engine tests use it to check the cap: at 64 processes spl starts nothing and kills nothing.

%name     "SPL Storm"
%author   "ASM Bots"
%strategy "Split until the process cap, and keep trying"

; Storm: start a child here, then go back and start another.
start:  spl     start
        jmp     start
