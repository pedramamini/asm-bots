; Every line after ';' is a comment.
%name     "Dwarf"                 ; ASM Bots metadata directives use %name/%author/%strategy
%author   "A. K. Dewdney"
%strategy "Bombs every 4th word with DAT, walking the whole core."

        org 0                     ; optional; always 0. Bots are position independent (see 6.4).
start:  call .here                ; the base-register idiom
.here:  pop  bx
        sub  bx, .here            ; bx = this bot's base address
        lea  di, [bx+bomb]        ; di = absolute address of our bomb
.loop:  add  di, 4
        mov  word [di], 0         ; drop a DAT every 4 bytes, forever, wrapping the core
        jmp  .loop
bomb:   dat
