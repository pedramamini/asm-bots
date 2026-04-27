import { tokenize } from '../lexer';
import { parse } from '../main';

describe('Parser', () => {
  it('should calculate symbol addresses correctly', () => {
    const source = `
      .org 0x100
      start:
        mov r0, 1
        inc r0
        jmp start
    `;
    const result = parse(source);
    expect(result.symbols['start']).toBe(0x100);
  });

  it('should handle .org', () => {
    const source = `
      .org 0x200
      label1:
        nop
    `;
    const result = parse(source);
    expect(result.symbols['label1']).toBe(0x200);
  });

  it('should handle DB/DW for address calculation', () => {
    const source = `
      start:
        db 1, 2, 3
        dw 0x1000, 0x2000
        label2:
        nop
    `;
    const result = parse(source);
    expect(result.symbols['start']).toBe(0);
    expect(result.symbols['label2']).toBe(3 + 2 * 2); // 3 bytes + 4 bytes = 7
  });
});
