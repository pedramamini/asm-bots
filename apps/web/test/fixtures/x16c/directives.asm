%name     "Dwarf"
%author   "A. K. Dewdney"
%strategy "Bomb every 4th byte; walk the core"
%version  "3"
%NAME     "case"
%define   STRIDE 4
%define BOMB mov word [di], 0
%define BASE bx
%macro bomb 1
        org     0
        bits    16
        align   4
        resb    STRIDE
        resw    2
        BOMB
        add     di, STRIDE % 3
start:  %name "x"
