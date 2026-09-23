; %define: macro names keep their case, and macro text keeps its spacing.
%name     "Macros"
%strategy "Macros are text: the formatter leaves them alone."
%define mov     nop
%define STRIDE  0ffh
%define PTR     bx+si
%define F       (1+2)
%define AX_     bx
%define ARGS    ax,1

start:  MOV     ax, STRIDE              ; MOV is not the macro mov, and mov would be
        add     ax, [PTR+2]
        dw      F * 2
        Mov     ARGS
        push    AX_
        mov                             ; the macro mov: this line is a nop
