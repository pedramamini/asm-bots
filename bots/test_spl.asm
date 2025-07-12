; Test SPL (split) instruction
.name "SPL Tester"

start:
    nop             ; Parent executes this
    spl child       ; Create child process at 'child' label
    nop             ; Parent continues here
    nop             ; Parent keeps going
    halt            ; Parent stops
child:
    nop             ; Child starts here
    nop             ; Child executes this
    nop             ; Child keeps going
    halt            ; Child stops