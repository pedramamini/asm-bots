; dat-in-code: DAT bytes that code falls into.
%name     "DatInCode"
%strategy "Code that runs into DAT."

start:  mov     ax, 1
        dat                             ; warns: mov falls through into it
        dat                             ; the rest of a run: no warning
.a:     inc     ax
        resb    2                       ; warns: resb is zeros, which are DAT
.b:     inc     ax
        resw    1                       ; warns
.c:     inc     ax
        align   4                       ; warns: here it pads 2 bytes
.d:     inc     ax
        align   1                       ; fine: it pads nothing
        times   2 dat                   ; warns
.e:     jmp     start
        dat                             ; fine: after a jmp

bomb:   dat                             ; fine
        db      0                       ; fine: db is data, not checked
