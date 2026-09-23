; Misalign jumps into the middle of two of its own instructions, so the core decodes their bytes
; from the wrong place, as it does for any process that lands in the middle of an instruction.
; From its first byte, B8 40 D6 is mov ax, 0xD640, but from its second byte it is inc ax (40) and
; then D6, an undefined opcode, which kills; B8 EB FE is mov ax, 0xFEEB, but from its second byte
; it is jmp $ (EB FE), a loop in the middle of an instruction.
; One process dies in the first and a second one spins in the other forever, so the engine tests
; use the bot to check that decode follows ip and not the listing.

%name     "Misalign"
%author   "ASM Bots"
%strategy "Jump into the middle of my own instructions"

; Start: a child goes one byte into lives, and this process goes one byte into dies.
start:  spl     lives + 1
        jmp     dies + 1

; Dies: from its second byte, inc ax and then an undefined opcode.
dies:   mov     ax, 0xD640

; Lives: from its second byte, jmp $.
lives:  mov     ax, 0xFEEB
