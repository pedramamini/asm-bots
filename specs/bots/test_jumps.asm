; Simple test bot to verify jumps and calls work
.name "Test Jumps"

start:
    nop             ; 0: Should execute
    jmp skip        ; 1: Should jump to skip
    halt            ; 2: Should NOT execute
skip:
    nop             ; 3: Should execute
    call function   ; 4: Should call function
    nop             ; 5: Should execute after return
    halt            ; 6: Should halt here
function:
    nop             ; 7: Should execute in function
    nop             ; 8: Should execute in function
    ret             ; 9: Should return to caller