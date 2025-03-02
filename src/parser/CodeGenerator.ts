import { Token, TokenType, SymbolTable } from './types.js';

export interface Instruction {
  opcode: number;
  operands: number[];
  size: number;
}

export interface MemorySegment {
  name: string;
  start: number;
  size: number;
  data: Uint8Array;  // Changed from number[] to Uint8Array
}

export interface GeneratedCode {
  segments: MemorySegment[];
  entryPoint: number;
}

export class CodeGenerator {
  private static readonly OPCODES: { [key: string]: number } = {
    // Basic instructions
    'mov': 0x10,
    'add': 0x20,
    'sub': 0x21,
    'mul': 0x22,
    'div': 0x23,
    
    // Jump/branch instructions
    'jmp': 0x30,
    'jz': 0x31,
    'jnz': 0x32,
    'je': 0x33,
    'jne': 0x34,
    'jl': 0x35,
    'jg': 0x36,
    'jge': 0x37,
    'jle': 0x38,
    
    // Stack operations
    'push': 0x40,
    'pop': 0x41,
    'call': 0x42,
    'ret': 0x43,
    
    // Logical operations
    'and': 0x50,
    'or': 0x51,
    'xor': 0x52,
    'not': 0x53,
    
    // Simple operations
    'inc': 0x60,
    'dec': 0x61,
    'nop': 0x00,
    'halt': 0xFF,
    
    // Comparison and special instructions
    'cmp': 0x70,  // Compare instruction
    'spl': 0xA0,  // Split process
    
    // Register handling aliases
    'load': 0x90, // Load from memory to register
    'store': 0x91, // Store from register to memory
    
    // X86-style aliases (map to the same opcodes for compatibility)
    'mov ax': 0x10,
    'mov bx': 0x10,
    'mov cx': 0x10,
    'mov dx': 0x10,
    'add ax': 0x20,
    'add bx': 0x20,
    'add cx': 0x20,
    'add dx': 0x20,
    'jz loop': 0x31,
    'jnz loop': 0x32,
    'dat': 0xF0,  // Data (used as a bomb)
    'test': 0x71, // Test bits
    'lea': 0x80,  // Load effective address
    'xchg': 0x11  // Exchange values
  };

  private static readonly REGISTERS: { [key: string]: number } = {
    'r0': 0x00,
    'r1': 0x01,
    'r2': 0x02,
    'r3': 0x03,
    'sp': 0x04,
    'pc': 0x05,
    'flags': 0x06,
    // Add x86-style registers
    'ax': 0x10,
    'bx': 0x11,
    'cx': 0x12,
    'dx': 0x13,
    'si': 0x14,
    'di': 0x15
  };

  // Set of valid registers for memory access checking
  private static readonly VALID_REGISTERS = new Set(Object.keys(CodeGenerator.REGISTERS));

  private symbols: SymbolTable;
  private baseAddress: number;
  private currentAddress: number;
  private segments: MemorySegment[];

  constructor() {
    this.symbols = {};
    this.baseAddress = 0;
    this.currentAddress = 0;
    this.segments = [];
  }

  encode(tokens: Token[]): Instruction[] {
    const instructions: Instruction[] = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === TokenType.Instruction) {
        const instruction = this.encodeInstruction(tokens, i);
        instructions.push(instruction);
        i += this.getInstructionLength(tokens, i);
      } else {
        i++;
      }
    }

    return instructions;
  }

  private getInstructionLength(tokens: Token[], startIndex: number): number {
    let length = 1; // Start with instruction token
    let i = startIndex + 1;

    while (i < tokens.length && this.isOperandToken(tokens[i])) {
      length++;
      i++;
    }

    return length;
  }

  private encodeInstruction(tokens: Token[], startIndex: number): Instruction {
    const token = tokens[startIndex];
    const opcode = CodeGenerator.OPCODES[token.value];

    if (opcode === undefined) {
      throw new Error(`Unknown instruction: ${token.value} at line ${token.line}`);
    }

    const operands: number[] = [];
    let i = startIndex + 1;

    while (i < tokens.length && this.isOperandToken(tokens[i])) {
      const operand = this.encodeOperand(tokens[i]);
      operands.push(operand);
      i++;
    }

    // Calculate size based on instruction type
    const size = this.calculateInstructionSize(opcode, operands);

    return { opcode, operands, size };
  }

  private calculateInstructionSize(opcode: number, operands: number[]): number {
    // Special cases for different instruction types
    if (opcode === 0xFF) { // HALT
      return 1;
    }

    // Jump instructions always have size 3
    if ((opcode >= 0x30 && opcode <= 0x38) || opcode === 0x42) {
      return 3;
    }

    // For other instructions, size is 1 (opcode) + 1 per operand
    if (operands.length === 0) {
      return 1;
    }

    // For MOV and arithmetic instructions with two operands
    if ((opcode === 0x10 || (opcode >= 0x20 && opcode <= 0x23)) && operands.length === 2) {
      return 3;
    }

    return 1 + operands.length;
  }

  private encodeOperand(token: Token): number {
    switch (token.type) {
      case TokenType.Register:
        return CodeGenerator.REGISTERS[token.value] || 0;
      
      case TokenType.Immediate:
        if (token.value.startsWith('0x')) {
          return parseInt(token.value.slice(2), 16);
        } else if (token.value.startsWith('$')) {
          return parseInt(token.value.slice(1), 16);
        } else {
          return parseInt(token.value, 10);
        }
      
      case TokenType.Address:
        return parseInt(token.value.slice(1), 16);
      
      case TokenType.Symbol:
        return this.symbols[token.value] || 0;
      
      case TokenType.MemoryAccess:
        // Memory access needs special encoding:
        // We'll mark it with a high bit to indicate memory access
        const memContents = token.value;
        if (memContents.includes('+')) {
          // Indexed addressing [reg+offset]
          const parts = memContents.split('+').map(p => p.trim());
          if (parts.length === 2) {
            const reg = parts[0].toLowerCase();
            const offset = parts[1];
            
            // For simplicity, we'll encode as (reg_code << 8 | offset)
            const regCode = CodeGenerator.REGISTERS[reg] || 0;
            const offsetVal = this.validateNumber(offset) 
              ? parseInt(offset, 0) 
              : (this.symbols[offset] || 0);
              
            return 0x8000 | (regCode << 8) | (offsetVal & 0xFF);
          }
        } else if (CodeGenerator.VALID_REGISTERS.has(memContents.toLowerCase())) {
          // Simple register indirect [reg]
          const regCode = CodeGenerator.REGISTERS[memContents.toLowerCase()] || 0;
          return 0x8000 | regCode;
        } else if (this.validateNumber(memContents)) {
          // Direct memory access [address]
          return 0x8000 | (parseInt(memContents, 0) & 0x7FFF);
        } else {
          // Symbol reference
          return 0x8000 | (this.symbols[memContents] || 0);
        }
        return 0;
      
      default:
        throw new Error(`Invalid operand type: ${token.type} at line ${token.line}`);
    }
  }

  private isOperandToken(token: Token): boolean {
    return token.type === TokenType.Register ||
           token.type === TokenType.Immediate ||
           token.type === TokenType.Address ||
           token.type === TokenType.Symbol ||
           token.type === TokenType.MemoryAccess;
  }
  
  private validateNumber(str: string): boolean {
    return /^-?\d+$/.test(str) || /^0x[0-9a-fA-F]+$/.test(str);
  }

  layout(instructions: Instruction[], symbols: SymbolTable): GeneratedCode {
    this.symbols = symbols;
    this.segments = [];
    this.currentAddress = this.baseAddress;

    // Create code segment
    const codeSegment: MemorySegment = {
      name: 'code',
      start: this.currentAddress,
      size: 0,
      data: new Uint8Array()  // Initialize with empty Uint8Array
    };

    // Layout instructions
    const tempData: number[] = [];
    for (const instruction of instructions) {
      tempData.push(instruction.opcode);
      tempData.push(...instruction.operands);
    }

    // Convert to Uint8Array
    codeSegment.data = new Uint8Array(tempData);
    codeSegment.size = codeSegment.data.length;
    this.segments.push(codeSegment);

    return {
      segments: this.segments,
      entryPoint: this.symbols['start'] || this.baseAddress
    };
  }

  relocate(baseAddress: number): void {
    const offset = baseAddress - this.baseAddress;

    if (offset === 0) return;

    // Update base address
    this.baseAddress = baseAddress;

    // Relocate segments
    for (const segment of this.segments) {
      segment.start += offset;

      // Update absolute addresses in code
      const data = Array.from(segment.data);  // Convert to array for easier manipulation
      for (let i = 0; i < data.length; i++) {
        const opcode = data[i];
        // Check if this is a jump or call instruction
        if ((opcode >= 0x30 && opcode <= 0x38) || opcode === 0x42) {
          // Next value is an address, adjust it
          if (i + 1 < data.length) {
            data[i + 1] += offset;
            i++; // Skip the adjusted address
          }
        }
      }
      segment.data = new Uint8Array(data);  // Convert back to Uint8Array
    }

    // Relocate symbols
    for (const symbol in this.symbols) {
      this.symbols[symbol] += offset;
    }
  }
}