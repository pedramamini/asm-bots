import { CodeGenerator } from './CodeGenerator';
import { Token, TokenType } from './types';

describe('CodeGenerator', () => {
  let generator: CodeGenerator;

  beforeEach(() => {
    generator = new CodeGenerator();
  });

  describe('encode()', () => {
    it('produces valid bytecode', () => {
      const tokens: Token[] = [
        { type: TokenType.Instruction, value: 'mov', line: 1 },
        { type: TokenType.Register, value: 'r0', line: 1 },
        { type: TokenType.Immediate, value: '42', line: 1 },
        { type: TokenType.Instruction, value: 'add', line: 2 },
        { type: TokenType.Register, value: 'r0', line: 2 },
        { type: TokenType.Register, value: 'r1', line: 2 }
      ];

      const instructions = generator.encode(tokens);

      expect(instructions).toEqual([
        { opcode: 0x10, operands: [0x00, 42], size: 3 },
        { opcode: 0x20, operands: [0x00, 0x01], size: 3 }
      ]);
    });

    it('handles all instruction types', () => {
      const tokens: Token[] = [
        { type: TokenType.Instruction, value: 'mov', line: 1 },
        { type: TokenType.Register, value: 'r0', line: 1 },
        { type: TokenType.Register, value: 'r1', line: 1 },
        { type: TokenType.Instruction, value: 'jmp', line: 2 },
        { type: TokenType.Address, value: '$1234', line: 2 },
        { type: TokenType.Instruction, value: 'halt', line: 3 }
      ];

      const instructions = generator.encode(tokens);

      expect(instructions).toEqual([
        { opcode: 0x10, operands: [0x00, 0x01], size: 3 },
        { opcode: 0x30, operands: [0x1234], size: 3 },
        { opcode: 0xFF, operands: [], size: 1 }
      ]);
    });

    it('throws error for invalid instructions', () => {
      const tokens: Token[] = [
        { type: TokenType.Instruction, value: 'invalid', line: 1 }
      ];

      expect(() => generator.encode(tokens)).toThrow('Unknown instruction');
    });
  });

  describe('layout()', () => {
    it('respects memory segments', () => {
      const instructions = [
        { opcode: 0x10, operands: [0x00, 42], size: 3 },
        { opcode: 0x20, operands: [0x00, 0x01], size: 3 },
        { opcode: 0xFF, operands: [], size: 1 }
      ];

      const symbols = { 'start': 0, 'data': 7 };
      const result = generator.layout(instructions, symbols);

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toEqual({
        name: 'code',
        start: 0,
        size: 7,
        data: [0x10, 0x00, 42, 0x20, 0x00, 0x01, 0xFF]
      });
      expect(result.entryPoint).toBe(0);
    });

    it('handles empty program', () => {
      const result = generator.layout([], {});

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].size).toBe(0);
      expect(result.entryPoint).toBe(0);
    });
  });

  describe('relocate()', () => {
    it('adjusts addresses properly', () => {
      // First layout the code at address 0
      const instructions = [
        { opcode: 0x30, operands: [0x0010], size: 3 }, // jmp 0x0010
        { opcode: 0x31, operands: [0x0020], size: 3 }  // jz  0x0020
      ];

      const symbols = { 'start': 0x0000, 'target1': 0x0010, 'target2': 0x0020 };
      const result = generator.layout(instructions, symbols);

      // Now relocate to address 0x1000
      generator.relocate(0x1000);

      // Check that segments were relocated
      expect(result.segments[0].start).toBe(0x1000);

      // Check that addresses in the code were adjusted
      const relocatedData = result.segments[0].data;
      expect(relocatedData).toEqual([
        0x30, 0x1010,  // jmp instruction now points to 0x1010
        0x31, 0x1020   // jz instruction now points to 0x1020
      ]);
    });

    it('handles zero offset relocation', () => {
      const instructions = [
        { opcode: 0x30, operands: [0x0010], size: 3 }
      ];

      const symbols = { 'start': 0x0000, 'target': 0x0010 };
      const result = generator.layout(instructions, symbols);
      const originalData = [...result.segments[0].data];

      generator.relocate(0x0000);

      expect(result.segments[0].data).toEqual(originalData);
    });
  });
});