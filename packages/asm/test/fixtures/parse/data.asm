%name     "Data"
%author   'A'
%strategy "Directives and data; nothing here runs."
%version  "1.0"
        org     0
        bits    16
size    equ     end - start
start:  db      "hi", 0, 'A', 'A'+1, "it's", ''
        dw      0x1234, -1, 'B', start, $ - $$
        resb    4
        resw    size / 2
        align   16
        times   16 dat
        times   2 db 1, 2
        times   3 rep movsb
buf:    times   (end - start) nop
end:
