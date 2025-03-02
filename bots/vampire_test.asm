; =================================================================
; Simplified Vampire Bot for Testing
; =================================================================

; This is a simplified version of the Vampire bot that doesn't halt
; and is more compatible with our current system implementation.

start:
    mov r0, 0x100      ; Start address for scanning
    mov r1, 0          ; Initialize counter
    
scan_loop:
    inc r1             ; Increment counter
    cmp r1, 100        ; Check if we've done 100 iterations
    jl continue        ; Continue if less than 100
    jmp start          ; Otherwise start over
    
continue:
    add r0, 4          ; Move to next memory location
    cmp r0, 0xF000     ; Check if we've reached the end of memory
    jl scan_loop       ; Continue scanning if not
    
    ; We never reach a halt instruction, so this bot keeps running forever
    jmp start          ; Start over