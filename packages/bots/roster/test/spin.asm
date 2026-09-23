; Spin runs `jmp $` forever and does nothing else.
; It never writes a byte, so it cannot hurt a rival, and only a rival's bomb can kill it.
; The engine tests use it as the bot that is still alive at the cycle cap.

%name     "Spin"
%author   "ASM Bots"
%strategy "Jump to itself forever"

start:  jmp     $
