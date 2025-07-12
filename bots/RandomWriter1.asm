.name RandomWriter1
.author MemoryPainter
.code

start:
    ; Initialize base register with a seed value
    mov r0, 12345
    mov r1, 0x1000  ; Start writing at 0x1000
    mov r2, 0xAA    ; Pattern to write

loop:
    ; Simple linear congruential generator for pseudo-random numbers
    ; r0 = (r0 * 1103515245 + 12345) & 0xFFFF
    mov r3, r0
    mul r3, 1103
    add r3, 12345
    mov r0, r3
    
    ; Use lower bits as offset from current position
    mov r3, r0
    and r3, 0x7FF   ; Limit to 2048 byte range
    
    ; Calculate write address
    add r3, r1
    
    ; Write our pattern to the calculated address
    mov [r3], r2
    
    ; Occasionally jump to a new base location
    mov r3, r0
    and r3, 0x1F    ; Check if lower 5 bits are zero
    jz new_location
    
    ; Continue with small increments
    inc r1
    inc r1
    inc r1
    jmp loop

new_location:
    ; Jump to a new random location
    mov r1, r0
    and r1, 0xFFFF  ; Use full 16-bit range
    jmp loop