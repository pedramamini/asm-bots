; =================================================================
; Fortress Bot - Establishes defensive position
; =================================================================
;
; Strategy:
; - Establishes defensive positions with strategic traps
; - Actively patrols its territory and attacks intruders
; - Maintains a strong defensive perimeter
; - Strong defensively but limited by stationary nature
;
; Battle Dynamics:
; vs Vampire: Strong initial defense against copies, but may eventually
;            be overwhelmed if too many vampires breach the perimeter
; vs Hunter:  Traps can catch precise attacks, but vulnerable to
;            Hunter's carpet bombing strategy
;
; =================================================================

.name "Fortress"
.author "Roo"
.version "1.0"
.strategy "Establish defensive position and attack threats"

.code
start:
    call setup_defense    ; Initialize defensive structure
    call patrol          ; Start defensive patrol
    jmp start           ; Repeat cycle

setup_defense:
    mov bx, defense_start ; Start of defensive zone
    mov cx, 4            ; Number of defensive points
setup_loop:
    mov word [bx], trap  ; Place trap
    add bx, 0x40         ; Space between traps
    dec cx               ; Decrease counter
    jnz setup_loop       ; Continue until done
    ret

patrol:
    mov bx, defense_start ; Start checking from first trap
    mov cx, 4            ; Number of points to check
patrol_loop:
    call check_point     ; Check this defensive point
    add bx, 0x40         ; Move to next point
    dec cx               ; Decrease counter
    jnz patrol_loop      ; Continue patrol
    ret

check_point:
    push bx              ; Save position
    sub bx, 0x10         ; Check area before trap
    mov dx, 0x20         ; Check range
scan_loop:
    cmp word [bx], trap  ; Is it our trap?
    jz next_scan         ; Yes, skip it
    cmp word [bx], 0     ; Empty space?
    jnz attack           ; No, found something
next_scan:
    add bx, 2            ; Next location
    dec dx               ; Decrease range
    jnz scan_loop        ; Continue scanning
    pop bx               ; Restore position
    ret

attack:
    mov word [bx], dat   ; Overwrite with deadly payload
    pop bx               ; Clean up stack
    ret

defense_start equ 0x300  ; Starting point for defense
trap: dw 0xAAAA          ; Trap pattern
dat: dw 0xFFFF           ; Attack pattern

code_size equ $ - start