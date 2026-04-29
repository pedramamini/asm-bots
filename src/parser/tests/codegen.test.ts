
import { Instruction, Operand, CodeGenerator } from '../codegen';
import { tokenize } from '../lexer';
import { firstPass, secondPass } from '../parser';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const describe = (name: string, fn: () => void) => {
  console.log(`Running suite: ${name}`);
  fn();
};

const it = (name: string, fn: () => void) => {
  console.log(`  Testing: ${name}`);
  try {
    fn();
    console.log(`    ✅ PASSED`);
  } catch (e: any) {
    console.error(`    ❌ FAILED: ${e.message}`);
    throw e;
  }
};

const expect = (actual: any) => ({
  toBe: (expected: any) => {
    if (actual !== expected) {
      throw new Error(`Expected ${expected} but got ${actual}`);
    }
  },
});

function assemble(source: string): { binary: Uint8Array, relocations: number[] } {
  const tokens = tokenize(source);
  const { symbols, currentAddress } = firstPass(tokens);
  const { resolvedTokens } = secondPass(tokens, symbols);
  
  // Very simple conversion from tokens to Instructions for testing
  // This part is usually in a 'CodeGenerator.generate' method, but for now
  // we'll manually construct them to test the binary encoding.
  const instructions: Instruction[] = [];
  let i = 0;
  while (i < resolvedTokens.length) {
    const token = resolvedTokens[i];
    if (token.type === 'Instruction') {
      const mnemonic = token.value;
      const opcode = 0x00; // Simplified for test construction
      const operands: Operand[] = [];
      
      // This is a hack to populate operands for the test
      // Real code would use a proper mapping
      i++;
      while (i < resolvedTokens.length && resolvedTokens[i].line === token.line) {
        const opToken = resolvedTokens[i];
        if (opToken.type === 'Immediate') {
          operands.push({ type: 'Immediate', value: parseInt(opToken.value), raw: opToken.value });
        } else if (opToken.type === 'Register') {
          // Map register name to code
          const regMap: Record<string, number> = { 'r0': 0, 'r1': 1, 'r2': 2, 'r3': 3, 'sp': 4, 'pc': 5, 'flags': 6 };
          operands.push({ type: 'Register', value: regMap[opToken.value] || 0, raw: opToken.value });
        }
        i++;
      }
      instructions.push({ mnemonic, opcode, operands, size: 0 });
    } else {
      i++;
    }
  }
  
  return CodeGenerator.layout(instructions);
}

describe('CodeGenerator: Encoding', () => {
  it('should encode NOP correctly', () => {
    const insts: Instruction[] = [
      { mnemonic: 'nop', opcode: 0x00, operands: [], size: 1 }
    ];
    const { binary } = CodeGenerator.layout(insts);
    expect(binary[0]).toBe(0x00);
    expect(binary.length).toBe(1);
  });

  it('should encode HALT correctly', () => {
    const insts: Instruction[] = [
      { mnemonic: 'halt', opcode: 0xFF, operands: [], size: 1 }
    ];
    const { binary } = CodeGenerator.layout(insts);
    expect(binary[0]).toBe(0xFF);
    expect(binary.length).toBe(1);
  });

  it('should encode MOV reg, imm correctly', () => {
    const insts: Instruction[] = [
      { mnemonic: 'mov', opcode: 0x10, operands: [
        { type: 'Register', value: 0, raw: 'r0' },
        { type: 'Immediate', value: 1, raw: '1' }
      ], size: 3 }
    ];
    const { binary } = CodeGenerator.layout(insts);
    // [Opcode, Reg, Imm]
    expect(binary[0]).toBe(0x10);
    expect(binary[1]).toBe(0);
    expect(binary[2]).toBe(1);
    expect(binary.length).toBe(3);
  });

  it('should encode JMP target (relative) correctly', () => {
    const insts: Instruction[] = [
      { mnemonic: 'jmp', opcode: 0x30, operands: [
        { type: 'Immediate', value: 0x1234, raw: '0x1234' }
      ], size: 3 }
    ];
    const { binary, relocations } = CodeGenerator.layout(insts);
    // [Opcode, Low, High]
    expect(binary[0]).toBe(0x30);
    expect(binary[1]).toBe(0x34);
    expect(binary[2]).toBe(0x12);
    expect(relocations[0]).toBe(1);
  });
});

describe('CodeGenerator: Relocation', () => {
  it('should relocate jump target correctly', () => {
    const binary = new Uint8Array([0x30, 0x34, 0x12]); // jmp 0x1234
    const relocations = [1];
    const base = 0x1000;
    const relocated = CodeGenerator.relocate(binary, base, relocations);
    
    // 0x1000 + 0x1234 = 0x2234
    // [0x30, 0x34, 0x22]
    expect(relocated[1]).toBe(0x34);
    expect(relocated[2]).toBe(0x22);
  });


  it('should wrap address when relocating', () => {
    const binary = new Uint8Array([0x30, 0x00, 0x80]); // jmp 0x8000
    const relocations = [1];
    const base = 0x8000;
    const relocated = CodeGenerator.relocate(binary, base, relocations);
    
    // 0x8000 + 0x8000 = 0x10000 -> 0x0000
    expect(relocated[1]).toBe(0);
    expect(relocated[2]).toBe(0);
  });

  it('should relocate a simple jump loop at multiple base addresses', () => {
    // Test Bot:
    // 0: nop (0x00)
    // 1: jmp 0 (0x30, 0x00, 0x00)
    const insts: Instruction[] = [
      { mnemonic: 'nop', opcode: 0x00, operands: [], size: 1 },
      { mnemonic: 'jmp', opcode: 0x30, operands: [
        { type: 'Immediate', value: 0, raw: '0' }
      ], size: 3 }
    ];
    const { binary, relocations } = CodeGenerator.layout(insts);
    
    const baseAddresses = [0x100, 0x500, 0x2000];
    
    for (const base of baseAddresses) {
      const relocated = CodeGenerator.relocate(binary, base, relocations);
      
      // Target is offset 0, so absolute address should be base + 0 = base
      const expectedLow = base & 0xFF;
      const expectedHigh = (base >> 8) & 0xFF;
      
      expect(relocated[2]).toBe(expectedLow);
      expect(relocated[3]).toBe(expectedHigh);
    }
  });
});
