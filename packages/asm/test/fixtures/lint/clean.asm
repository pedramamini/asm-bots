; A clean bot: base register for its own data, di set before the string copy, data after a jmp.
%name     "Clean"
%author   "ASM Bots"
%strategy "Copies itself 0x400 bytes ahead, then bombs the gap behind it."

start:  call    .here
.here:  pop     bx
        sub     bx, .here               ; bx = base address
        lea     si, [bx+start]
        lea     di, [bx+0x400]
        mov     cx, (end - start) / 2
        rep     movsw
        lea     di, [bx+bomb]
.loop:  add     di, 4
        mov     ax, [bx+bomb]
        mov     [di], ax
        jmp     .loop

bomb:   dat
end:
