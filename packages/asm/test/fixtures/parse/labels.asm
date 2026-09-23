; Local labels belong to the global label before them (NASM rules).
.early: nop                     ; no global label yet: the name stays .early
start:
.loop:  jmp     .loop           ; start.loop
size    equ     4               ; an equ name leaves the scope alone
.next:  jmp     .loop           ; start.next, start.loop
..@tmp: nop                     ; ..@ names are global, and leave the scope alone
.last:  nop                     ; start.last
other:  jmp     start.loop      ; a full name reaches into another scope
.loop:  jmp     .loop           ; other.loop
; A label may drop its colon before a statement keyword.
msg     db      "hi"
count   equ     3
here    mov     ax, msg
; A $ escapes a reserved word; a mnemonic can be a label, as in NASM.
$ax:    dw      $ax
loop:   loop    loop
$.x:    dw      .x              ; loop.x
