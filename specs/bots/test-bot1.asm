; Simple warrior bot that moves through memory
.name "Warrior"
.author "Test"

.code
start:
    mov ax, 0x1234    ; Load test value
    mov bx, 100       ; Offset
loop:
    mov [bx], ax      ; Write to memory
    add bx, 1         ; Increment pointer
    cmp bx, 200       ; Check boundary
    jl loop           ; Continue if less
    mov bx, 100       ; Reset pointer
    jmp loop          ; Repeat forever