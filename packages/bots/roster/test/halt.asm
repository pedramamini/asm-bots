; Halt runs hlt as its first instruction.
; x16c kills a process that runs hlt, so the bot dies on its first turn without a write.
; The engine tests use it as the bot that dies first.

%name     "Halt"
%author   "ASM Bots"
%strategy "Run hlt at once and die"

start:  hlt                             ; lint: allow hlt-in-code: dying at once is the whole bot
