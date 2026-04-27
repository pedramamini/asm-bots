.name RandomWriter2
.author ChaosPainter
.code

start:
    ; Initialize with different seed and pattern
    mov r0, 54321   ; Different seed than RandomWriter1
    mov r1, 0x8000  ; Start at middle of memory
    mov r2, 0x55    ; Different pattern (0x55 vs 0xAA)
    mov r3, 0       ; Direction flag

main_loop:
    ; Different pseudo-random algorithm - simple LCG variant
    ; r0 = (r0 * 1597 + 51749) & 0xFFFF
    mov r3, r0
    mul r3, 1597
    add r3, 51749
    and r3, 0xFFFF
    mov r0, r3
    
    ; Use random value to determine write location
    mov r3, r0
    and r3, 0x3FF   ; Limit to 1024 byte range
    
    ; Add to current position
    add r3, r1
    
    ; Write our different pattern
    mov [r3], r2
    
    ; Occasionally reverse direction
    mov r3, r0
    and r3, 0x3F    ; Check lower 6 bits
    jz reverse_direction
    
    ; Continue in current direction
    cmp r0, 0x8000  ; Check if random value is high
    jl move_forward
    
move_backward:
    sub r1, 5       ; Move backward 5 bytes
    jmp check_bounds
    
move_forward:
    add r1, 7       ; Move forward 7 bytes
    
check_bounds:
    ; Wrap around if needed
    mov r3, r1
    and r3, 0xFFFF  ; Keep within 16-bit range
    mov r1, r3
    jmp main_loop

reverse_direction:
    ; Jump to completely new area
    mov r1, r0
    add r1, r1      ; Double by adding to itself instead of shift
    and r1, 0xFFFF  ; Keep in bounds
    
    ; Also change pattern occasionally
    inc r2
    jmp main_loop