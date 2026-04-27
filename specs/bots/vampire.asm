; =================================================================
; Vampire Bot - Creates copies and drains resources
; =================================================================
;
; Strategy:
; - Creates copies of itself to spread across memory
; - Searches for other bots and corrupts their code
; - Uses replication to maintain presence even if some copies are destroyed
; - Vulnerable while copying but makes up for it in numbers
;
; Battle Dynamics:
; vs Fortress: May struggle initially against defenses but can eventually
;             overwhelm through sheer numbers of copies
; vs Hunter:   Vulnerable to Hunter's efficient scanning pattern which
;             can find and eliminate copies before they spread too far
;
; =================================================================

.name "Vampire"
.author "Roo"
.version "1.0"
.strategy "Create copies and drain resources from other bots"

.code
start:
    call find_space     ; Find space for replication
    call replicate      ; Create a copy
    call find_target    ; Look for other bots
    jmp start          ; Repeat cycle

find_space:
    mov bx, 0x200      ; Start searching from 0x200
scan_loop:
    cmp word [bx], 0   ; Check if space is empty
    jz space_found     ; If empty, use this space
    add bx, 0x10       ; Try next block
    jmp scan_loop
space_found:
    ret

replicate:
    mov cx, code_size  ; Get size of code to copy
    mov dx, bx         ; Save target location
copy_loop:
    mov ax, [si]       ; Load byte from source
    mov [bx], ax       ; Store at destination
    inc si             ; Next source byte
    inc bx             ; Next destination byte
    dec cx             ; Decrease counter
    jnz copy_loop      ; Continue until done
    spl dx             ; Start new copy
    ret

find_target:
    mov bx, 0x100      ; Start searching
    mov cx, 0x1000     ; Search range
search_loop:
    cmp word [bx], 0   ; Look for non-empty memory
    jnz attack         ; Found something
    add bx, 2          ; Next location
    dec cx             ; Decrease range
    jnz search_loop    ; Continue searching
    ret

attack:
    mov ax, [bx]       ; Load target instruction
    xor ax, 0xFFFF     ; Corrupt it
    mov [bx], ax       ; Write back
    ret

code_size equ $ - start