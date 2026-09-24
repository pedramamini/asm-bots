; Numbers, characters, and strings (ISA §6.1), good and bad.
        db      123, 0x1F, 0X1f, 1Fh, 0FFh, 00FFh, 0b1010, 0B101, 0B800h, 1H
        db      -7, 'A', "B", '\n', '\'', "\"", '\q'
        db      "hi", 'two', "", 'a\tb', "ends in \\"
        db      "unterminated
        db      'x
        db      1010b, 0x, 0b, 0b102, 1_000, 1.5, 0x1Fh, 99999999999999999
        mov     ax, $1F
