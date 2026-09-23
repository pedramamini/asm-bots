; unreachable: code after jmp, ret, hlt, int3, or dat, with no label between.
%name     "Unreachable"
%strategy "Code that nothing reaches."

start:  jmp     .over
        nop                             ; warns: after jmp
        nop                             ; the same run: no second warning
.over:  call    work
        jz      start                   ; a conditional jump falls through
        jmp     short $
.again:
        dec     cx                      ; fine: .again names it
        jmp     start
        dat                             ; data after a jmp: fine
        mov     ax, 1                   ; warns: after the jmp and the dat

work:   ret
        db      0x90                    ; data: fine
        inc     ax                      ; warns: after ret, db or not
        times   2 nop                   ; the same run
.data:  dw      0                       ; a label: fine
        int3
        nop                             ; warns: after int3
