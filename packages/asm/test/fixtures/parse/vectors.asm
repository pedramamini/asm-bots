mov ax, 0x1234
mov word [bx], 0
mov byte [bx+si+4], 0x41
mov ax, [0x0100]
mov cx, [bp]
add bx, 4
add bx, 0x100
cmp al, 0
xor ax, ax
inc bx
dec word [di]
shl ax, 1
shr ax, cl
jmp short $
jmp $ + 0x200
jnz $ - 10
loop $ - 4
call $ + 3
pop bx
push word [bx]
rep movsw
repne scasb
spl $ + 2
spl $ + 0x300
spl bx
dat
hlt
int3
nop
lea si, [bx+di-2]
