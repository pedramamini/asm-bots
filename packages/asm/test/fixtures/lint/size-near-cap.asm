; size-near-cap: 90% of the 512-byte limit or more.
%name     "Big"
%strategy "Four hundred and sixty-one bytes."

start:  times   458 nop
        jmp     start                   ; rel16: 3 bytes, 461 in all
