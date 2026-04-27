; Counter bot - counts from 0 to 10
start:
mov r0 0       ; Initialize counter
loop:
inc r0         ; Increment counter
cmp r0 10      ; Compare with 10
jnz loop       ; Loop if not zero
halt           ; Stop execution