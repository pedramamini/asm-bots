%define
%define 5 x
%define F(x) x+1
%define A0 x x x x x x x x x x
%define A1 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0
%define A2 A1 A1 A1 A1 A1 A1 A1 A1 A1 A1
%define A3 A2 A2 A2 A2 A2 A2 A2 A2 A2 A2
        dw      A3
%define ADDR [bx+bp]
        mov     ax, ADDR
