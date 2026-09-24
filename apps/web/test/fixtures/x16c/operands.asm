        mov     word [bx+si+4], 0x41   ; a comment, with 'quotes' and [brackets]
        mov     byte [bp], -1
        lea     di, [bx+bomb-2]
        add     ax, (1 << 4) | ~0 & 0xFF ^ 3
        sub     cx, 10 >> 1
        jmp     short $ + 2
        jmp     near $$
        add     ax, strict word 1
        mov     ax, [es:bx]
        mov     ax, 5 < 3
        mov     ax, 5 // 2 @ !
        spl     dx
        jnz     .loop
	mov	ax, bx	; tabs
;
