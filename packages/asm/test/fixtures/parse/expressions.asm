; Every number form (ISA 6.1), and C precedence.
        dw      123, 0x1F, 1Fh, 0b1010, 'A', -7
        dw      1 | 2 ^ 3 & 4 << 1 + 2 * 3
        dw      (1 + 2) * 3, -(4), ~0x80, +5
        dw      10 - 3 - 2, 64 / 4 / 2 % 3
        dw      $, $$, $ - $$, $+2
        mov     ax, (end - start) >> 1
start:
end:
