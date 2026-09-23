; Div Zero divides dx:ax by cx while cx is 0.
; The 8086 raises a divide error there, and x16c has no handler for it, so the process dies with
; the reason div.
; The engine tests use it to check that death: the bot dies on its second turn, on the div.

%name     "Div Zero"
%author   "ASM Bots"
%strategy "Divide by zero and die"

; Divide: by zero.
start:  xor     cx, cx
        div     cx
        jmp     $                       ; never runs: the div kills the process
