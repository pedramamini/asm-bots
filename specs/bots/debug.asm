; =================================================================
; Debug Bot
; =================================================================
; This bot is designed to help diagnose issues with ASM-Bots
; It only uses a few simple instructions with absolute memory
; references to minimize parsing and relocation issues

; r0 will be our counter
mov r0, 1

; Main loop (increase counter)
main_loop:
  inc r0
  
  ; Check counter value - if r0 > 100, restart
  cmp r0, 100
  jl main_loop  ; If r0 < 100, keep going
  
  ; Reset counter and continue
  mov r0, 0
  jmp main_loop