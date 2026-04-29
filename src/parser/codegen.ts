export interface Instruction {
  mnemonic: string;
  opcode: number;
  operands: Operand[];
  size: number;
}

export interface Operand {
  type: 'Register' | 'Immediate' | 'Memory';
  value: number;
  raw: string;
}

export const OPCODE_MAP: Record<string, { opcode: number, size: number }> = {
  'nop': { opcode: 0x00, size: 1 },
  'halt': { opcode: 0xFF, size: 1 },
  'ret': { opcode: 0x43, size: 1 },
  'mov': { opcode: 0x10, size: 3 },
  'xchg': { opcode: 0x11, size: 3 },
  'add': { opcode: 0x20, size: 3 },
  'sub': { opcode: 0x21, size: 3 },
  'mul': { opcode: 0x22, size: 3 },
  'div': { opcode: 0x23, size: 3 },
  'and': { opcode: 0x50, size: 3 },
  'or': { opcode: 0x51, size: 3 },
  'xor': { opcode: 0x52, size: 3 },
  'not': { opcode: 0x53, size: 2 },
  'inc': { opcode: 0x60, size: 2 },
  'dec': { opcode: 0x61, size: 2 },
  'cmp': { opcode: 0x70, size: 3 },
  'test': { opcode: 0x71, size: 3 },
  'jmp': { opcode: 0x30, size: 3 },
  'jz': { opcode: 0x31, size: 3 },
  'jnz': { opcode: 0x32, size: 3 },
  'je': { opcode: 0x33, size: 3 },
  'jne': { opcode: 0x34, size: 3 },
  'jl': { opcode: 0x35, size: 3 },
  'jg': { opcode: 0x36, size: 3 },
  'jge': { opcode: 0x37, size: 3 },
  'jle': { opcode: 0x38, size: 3 },
  'push': { opcode: 0x40, size: 2 },
  'pop': { opcode: 0x41, size: 2 },
  'call': { opcode: 0x42, size: 3 },
  'spl': { opcode: 0xA0, size: 3 },
  'dat': { opcode: 0xF0, size: 3 },
  'db': { opcode: 0xF1, size: 2 },
};

export function calculateInstructionSize(mnemonic: string): number {
  const mapping = OPCODE_MAP[mnemonic.toLowerCase()];
  return mapping ? mapping.size : 1;
}

export class CodeGenerator {
  /**
   * Encodes a 16-bit value into a 2-byte Uint8Array (little-endian).
   */
  private static encode16(val: number): Uint8Array {
    const bytes = new Uint8Array(2);
    bytes[0] = val & 0xFF;
    bytes[1] = (val >> 8) & 0xFF;
    return bytes;
  }

  /**
   * Encodes an operand based on CODEGEN_SPEC.
   * Returns the bytes for the operand.
   */
  private static encodeOperand(operand: Operand): Uint8Array {
    if (operand.type === 'Register') {
      return new Uint8Array([operand.value]);
    }

    if (operand.type === 'Immediate') {
      // According to CODEGEN_SPEC: 
      // Registers: 0..3 -> r0..r3, 4=sp, 5=pc, 6=flags
      // Immediate / Memory: >= 7 -> Literal value or memory reference.
      // Memory Reference Encoding (Bit 15 set): If a value is a memory reference, the high bit (0x8000) is set.
      
      // Check if it's a memory reference (Bit 15 set)
      if (operand.value & 0x8000) {
        return this.encode16(operand.value);
      }
      
      // For non-jump operands, 1 byte each.
      // If the value is 0-6 and marked 'Immediate', it's a literal 0-6 (though usually these are registers).
      // If value is 7-255, it's a 1-byte literal.
      // If value > 255, it must be 2 bytes.
      if (operand.value >= 0 && operand.value <= 255) {
        return new Uint8Array([operand.value]);
      }
      return this.encode16(operand.value);
    }

    if (operand.type === 'Memory') {
      return this.encode16(operand.value | 0x8000);
    }

    return new Uint8Array([0]);
  }

  /**
   * Transforms a list of instructions into a binary byte stream.
   * Returns the binary and a list of offsets that are absolute addresses (for relocation).
   */
  static encode(instructions: Instruction[]): { binary: Uint8Array, relocations: number[] } {
    const chunks: Uint8Array[] = [];
    const relocations: number[] = [];
    let currentOffset = 0;

    for (const inst of instructions) {
      const bytes: number[] = [];
      bytes.push(inst.opcode);

    for (const op of inst.operands) {
      let opBytes: Uint8Array;
      
      // Mark for relocation and force 2-byte encoding for jump/call/spl targets
      if (['jmp', 'jz', 'jnz', 'je', 'jne', 'jl', 'jg', 'jge', 'jle', 'call', 'spl'].includes(inst.mnemonic.toLowerCase()) && 
          (op.type === 'Immediate' || op.type === 'Memory')) {
        
        const value = op.type === 'Memory' ? (op.value | 0x8000) : op.value;
        opBytes = this.encode16(value);
        relocations.push(currentOffset + bytes.length);
      } else {
        opBytes = this.encodeOperand(op);
      }
      
      for (let i = 0; i < opBytes.length; i++) {
        bytes.push(opBytes[i]);
      }
    }

      const instBinary = new Uint8Array(bytes);
      chunks.push(instBinary);
      currentOffset += instBinary.length;
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const binary = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      binary.set(chunk, offset);
      offset += chunk.length;
    }

    return { binary, relocations };
  }

  /**
   * Packs Instruction objects into a Uint8Array.
   * In this implementation, it's a wrapper around encode.
   */
  static layout(instructions: Instruction[]): { binary: Uint8Array, relocations: number[] } {
    return this.encode(instructions);
  }

  /**
   * Updates jump targets in the binary based on a base address M.
   * Formula: A_absolute = M + O_target
   */
  static relocate(binary: Uint8Array, M: number, relocations: number[]): Uint8Array {
    const result = new Uint8Array(binary);
    for (const offset of relocations) {
      // Read original relative offset (little-endian)
      const low = result[offset];
      const high = result[offset + 1];
      const oTarget = low | (high << 8);
      
      // Calculate absolute address
      const aAbsolute = (M + oTarget) & 0xFFFF;
      
      // Write back as little-endian
      result[offset] = aAbsolute & 0xFF;
      result[offset + 1] = (aAbsolute >> 8) & 0xFF;
    }
    return result;
  }
}
