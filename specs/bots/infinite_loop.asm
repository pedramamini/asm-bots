; =================================================================
; Infinite Loop Bot for Testing
; =================================================================

; This bot simply contains an infinite loop with no halt instruction
; Uses absolute jump instructions with no labels to simplify parsing

; Initialize registers
mov r0, 0x100      ; Start address for scanning
mov r1, 0          ; Initialize counter

; Main loop to increment and scan
inc r1             ; Increment counter
cmp r1, 100        ; Check if we've done 100 iterations
jl 0x14            ; Jump to add instruction if less than 100 (continue)
jmp 0x0            ; Jump back to start if counter reaches 100

; Continue scanning (will be jumped to from the jl instruction)
add r0, 4          ; Move to next memory location
cmp r0, 0xF000     ; Check if we've reached the end of memory
jl 0x8             ; Jump back to main loop if not at end

; This point is never reached, but just in case
jmp 0x0            ; Jump back to start