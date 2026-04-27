; Simple scanner bot that searches and overwrites
.name "Scanner"
.author "Test"

.code
start:
    mov cx, 0         ; Start at 0
    mov dx, 0x5678    ; Pattern to write
scan:
    mov ax, [cx]      ; Read memory
    cmp ax, 0         ; Check if empty
    je skip           ; Skip if empty
    mov [cx], dx      ; Overwrite
skip:
    add cx, 3         ; Jump by 3
    cmp cx, 1000      ; Boundary check
    jl scan           ; Continue scanning
    mov cx, 0         ; Reset
    jmp scan          ; Repeat