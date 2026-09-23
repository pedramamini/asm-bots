%define STRIDE 4
%define BOMB   word [di]
%define PTR    bx+si
%define SIZE   (end - start)
%define EMPTY
start:  add     di, STRIDE
        mov     BOMB, 0
        mov     ax, [PTR+2]
        dw      SIZE, STRIDE * 2 EMPTY
%define STRIDE 8                ; a new definition applies from here on
        add     di, STRIDE
%define LATER  NEXT             ; the text expands where it is used
%define NEXT   3
        dw      LATER
%define SELF   SELF + 1         ; a macro does not expand inside itself
        dw      SELF
end:
