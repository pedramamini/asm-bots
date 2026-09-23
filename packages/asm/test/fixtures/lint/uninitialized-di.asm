; uninitialized-di: a string instruction that uses di before any line sets di.
%name     "NoDi"
%strategy "Copies before it points di anywhere."

start:  lodsb                           ; fine: lodsb uses si only
        rep     stosw                   ; warns
        times   2 movsb                 ; warns
        cmp     di, 0                   ; reads di
        push    di                      ; reads di
        scasb                           ; warns
        xchg    ax, di                  ; sets di
        cmpsw                           ; fine
        jmp     start
