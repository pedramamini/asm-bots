import { AssemblyParser } from './AssemblyParser';
import { TokenType } from './types';

describe('AssemblyParser', () => {
  let parser: AssemblyParser;

  beforeEach(() => {
    parser = new AssemblyParser();
  });

  describe('tokenize()', () => {
    it('identifies all elements', () => {
      const source = `
        ; Initialize program
        start:
          mov r0, #42      ; Load immediate value
          mov r1, $FF00    ; Load from memory
          jmp loop         ; Jump to loop
        loop:
          add r0, r1       ; Add registers
          jnz start       ; Jump if not zero
      `;

      const tokens = parser.tokenize(source);

      // Verify all token types are correctly identified
      expect(tokens).toEqual(expect.arrayContaining([
        { type: TokenType.Label, value: 'start', line: 3 },
        { type: TokenType.Instruction, value: 'mov', line: 4 },
        { type: TokenType.Register, value: 'r0', line: 4 },
        { type: TokenType.Immediate, value: '42', line: 4 },
        { type: TokenType.Instruction, value: 'mov', line: 5 },
        { type: TokenType.Register, value: 'r1', line: 5 },
        { type: TokenType.Address, value: '$FF00', line: 5 },
        { type: TokenType.Instruction, value: 'jmp', line: 6 },
        { type: TokenType.Symbol, value: 'loop', line: 6 },
        { type: TokenType.Label, value: 'loop', line: 7 },
        { type: TokenType.Instruction, value: 'add', line: 8 },
        { type: TokenType.Register, value: 'r0', line: 8 },
        { type: TokenType.Register, value: 'r1', line: 8 },
        { type: TokenType.Instruction, value: 'jnz', line: 9 },
        { type: TokenType.Symbol, value: 'start', line: 9 }
      ]));
    });

    it('handles empty lines and comments', () => {
      const source = `
        ; This is a comment

        mov r0, #1 ; Inline comment
        ; Another comment
      `;

      const tokens = parser.tokenize(source);
      expect(tokens).toHaveLength(3); // mov, r0, #1
    });
  });

  describe('validate()', () => {
    it('catches syntax errors', () => {
      const source = `
        start:
          mov r0, #42x     ; Invalid immediate value
          mov rx, $FF00    ; Invalid register
          jmp @loop        ; Invalid symbol
        loop:
          add r0, r1
          jnz start
      `;

      parser.tokenize(source);
      const errors = parser.validate();

      expect(errors).toHaveLength(3);
      expect(errors[0].message).toContain('Invalid immediate value');
      expect(errors[1].message).toContain('Invalid register');
      expect(errors[2].message).toContain('Invalid operand');
    });

    it('catches undefined symbols', () => {
      const source = `
        start:
          mov r0, #42
          jmp nonexistent  ; Undefined label
      `;

      parser.tokenize(source);
      const errors = parser.validate();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Undefined symbol');
    });
  });

  describe('resolveSymbols()', () => {
    it('handles all references', () => {
      const source = `
        start:    ; Address 0
          nop     ; Address 1
        data:     ; Address 2
          nop     ; Address 3
        end:      ; Address 4
          jmp start
          jmp data
          jmp end
      `;

      parser.tokenize(source);
      const symbols = parser.resolveSymbols();

      expect(symbols).toEqual({
        'start': 0,
        'data': 2,
        'end': 4
      });
    });

    it('maintains correct addresses with multi-line instructions', () => {
      const source = `
        start:          ; Address 0
          mov r0, #42   ; Address 1
          mov r1, r0    ; Address 2
        loop:           ; Address 3
          add r0, #1    ; Address 4
          jnz loop      ; Address 5
      `;

      parser.tokenize(source);
      const symbols = parser.resolveSymbols();

      expect(symbols).toEqual({
        'start': 0,
        'loop': 3
      });
    });
  });

  describe('parse()', () => {
    it('returns complete parse result', () => {
      const source = `
        start:
          mov r0, #42
          jmp start
      `;

      const result = parser.parse(source);

      expect(result).toHaveProperty('tokens');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('symbols');
      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveProperty('start');
    });
  });
});