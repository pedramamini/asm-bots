; =================================================================
; Hunter Bot - Actively hunts and destroys other bots
; =================================================================
;
; Strategy:
; - Uses efficient prime-number-based scanning pattern
; - Can perform precise attacks on single targets
; - Switches to carpet bombing when multiple targets detected
; - Aggressive hunter that actively seeks out enemies
;
; Battle Dynamics:
; vs Vampire: Highly effective at finding and eliminating vampire
;            copies before they can spread too far
; vs Fortress: Precise attacks may be caught by fortress traps, but
;             carpet bombing strategy can effectively break through
;             defensive structures
;
; =================================================================

.name "Hunter"
.author "Roo"
.version "1.0"
.strategy "Efficient scanning and targeting system"

.code
start:
    call init_scanner    ; Initialize scanning pattern
    call hunt           ; Begin hunting
    jmp start          ; Repeat cycle

init_scanner:
    mov bx, 0x100      ; Start position
    mov cx, step       ; Initialize step size
    mov dx, 0          ; Initialize hit counter
    ret

hunt:
    call scan          ; Scan for targets
    cmp dx, 2          ; Found multiple hits?
    jge bomb_area      ; Yes, carpet bomb the area
    call precise_shot  ; No, take precise shot
    ret

scan:
    mov ax, [bx]       ; Read memory
    cmp ax, 0          ; Empty?
    jz continue_scan   ; Yes, continue
    inc dx             ; Count hit
    mov si, bx         ; Save location
continue_scan:
    add bx, cx         ; Jump by step size
    cmp bx, 0xF000     ; Near end of memory?
    jl scan           ; No, continue scanning
    ret

bomb_area:
    mov cx, 8          ; Bomb 8 locations
bomb_loop:
    mov word [si], bomb ; Place bomb
    add si, 2          ; Next location
    dec cx             ; Decrease counter
    jnz bomb_loop      ; Continue bombing
    ret

precise_shot:
    cmp dx, 0          ; Any hits?
    jz return          ; No, return
    mov word [si], dart ; Place precise attack
return:
    ret

step: dw 0x37         ; Prime number step size
bomb: dw 0xFFFF       ; Area attack pattern
dart: dw 0xF0F0       ; Precise attack pattern

code_size equ $ - start