; Simple test bot that just moves data
start:
mov r0 1       ; Set register 0 to 1
mov r1 2       ; Set register 1 to 2
add r0 r1      ; Add r1 to r0
mov r2 r0      ; Move result to r2
halt           ; Stop execution