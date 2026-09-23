; hlt-in-code: a hlt the bot runs halts the bot.
%name     "Halts"
%strategy "Halts on purpose and by accident."

start:  dec     cx
        jz      .stop                   ; names .stop
        call    .work
        hlt                             ; warns: the call returns into it
.stop:  hlt                             ; warns: jz names .stop
.work:  inc     ax
        times   2 hlt                   ; warns: inc falls through into it

template:
        hlt                             ; fine: nothing runs into it, and no jump names it
