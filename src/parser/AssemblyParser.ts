import { Token, TokenType, ParseError, ParseResult, SymbolTable } from './types';

export class AssemblyParser {
  private source: string = '';
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private symbols: SymbolTable = {};
  private currentAddress: number = 0;

  // Valid instructions for our assembly language
  private static readonly VALID_INSTRUCTIONS = new Set([
    'mov', 'add', 'sub', 'mul', 'div',
    'jmp', 'jz', 'jnz', 'je', 'jne',
    'push', 'pop', 'call', 'ret',
    'and', 'or', 'xor', 'not',
    'inc', 'dec', 'nop', 'halt'
  ]);

  // Valid registers
  private static readonly VALID_REGISTERS = new Set([
    'r0', 'r1', 'r2', 'r3',
    'sp', 'pc', 'flags'
  ]);

  tokenize(source: string): Token[] {
    this.source = source;
    this.tokens = [];
    this.errors = [];
    this.symbols = {};
    this.currentAddress = 0;

    const lines = source.split('\n');
    const lineAddresses = new Map<number, number>();
    const labelLines = new Set<number>();

    // First pass: collect labels and calculate addresses
    let addr = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith(';')) {
        continue;
      }

      const currentLineNum = lineNum + 1;
      lineAddresses.set(currentLineNum, addr);

      if (line.endsWith(':')) {
        const label = line.slice(0, -1).trim();
        if (this.validateIdentifier(label)) {
          this.symbols[label] = addr;
          labelLines.add(currentLineNum);
        }
      } else {
        // Count instruction lines
        const parts = line.split(/[\s,]+/).filter(part => part && !part.startsWith(';'));
        const instruction = parts[0].toLowerCase();
        if (AssemblyParser.VALID_INSTRUCTIONS.has(instruction)) {
          addr++;
        }
      }
    }

    // Second pass: tokenize instructions and operands
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith(';')) {
        continue;
      }

      const currentLineNum = lineNum + 1;
      this.currentAddress = lineAddresses.get(currentLineNum) || 0;

      try {
        if (labelLines.has(currentLineNum)) {
          // Handle label
          const label = line.slice(0, -1).trim();
          if (this.validateIdentifier(label)) {
            this.tokens.push({
              type: TokenType.Label,
              value: label,
              line: currentLineNum
            });
          }
        } else {
          // Split line into parts, handling comments
          const parts = line.split(/[\s,]+/).filter(part => part && !part.startsWith(';'));
          const instruction = parts[0].toLowerCase();

          // Validate instruction
          if (!AssemblyParser.VALID_INSTRUCTIONS.has(instruction)) {
            throw new Error(`Invalid instruction: ${instruction}`);
          }

          this.tokens.push({
            type: TokenType.Instruction,
            value: instruction,
            line: currentLineNum
          });

          // Parse operands
          for (let i = 1; i < parts.length; i++) {
            const operand = parts[i].trim();
            if (operand) {
              this.tokenizeOperand(operand, currentLineNum);
            }
          }
        }
      } catch (error) {
        this.errors.push({
          message: error instanceof Error ? error.message : 'Unknown error',
          line: currentLineNum
        });
      }
    }

    return this.tokens;
  }

  private tokenizeOperand(operand: string, lineNum: number): void {
    if (operand.startsWith('#')) {
      // Immediate value
      const value = operand.slice(1);
      if (!this.validateNumber(value)) {
        this.errors.push({
          message: `Invalid immediate value: ${value}`,
          line: lineNum
        });
        return;
      }
      this.tokens.push({
        type: TokenType.Immediate,
        value: value,
        line: lineNum
      });
    } else if (operand.startsWith('$')) {
      // Hexadecimal address
      const value = operand.slice(1);
      if (!this.validateHexAddress(value)) {
        this.errors.push({
          message: `Invalid address: ${value}`,
          line: lineNum
        });
        return;
      }
      this.tokens.push({
        type: TokenType.Address,
        value: operand,
        line: lineNum
      });
    } else if (AssemblyParser.VALID_REGISTERS.has(operand.toLowerCase())) {
      // Register
      this.tokens.push({
        type: TokenType.Register,
        value: operand.toLowerCase(),
        line: lineNum
      });
    } else if (this.validateIdentifier(operand)) {
      // Symbol reference
      if (!(operand in this.symbols)) {
        this.errors.push({
          message: `Undefined symbol: ${operand}`,
          line: lineNum
        });
      }
      this.tokens.push({
        type: TokenType.Symbol,
        value: operand,
        line: lineNum
      });
    } else {
      this.errors.push({
        message: `Invalid operand: ${operand}`,
        line: lineNum
      });
    }
  }

  validate(): ParseError[] {
    return [...this.errors];
  }

  resolveSymbols(): SymbolTable {
    return { ...this.symbols };
  }

  parse(source: string): ParseResult {
    this.tokenize(source);
    const errors = this.validate();

    return {
      tokens: this.tokens,
      errors: errors,
      symbols: this.symbols
    };
  }

  private validateIdentifier(id: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id);
  }

  private validateNumber(num: string): boolean {
    return /^-?\d+$/.test(num) || /^0x[0-9a-fA-F]+$/.test(num);
  }

  private validateHexAddress(addr: string): boolean {
    return /^[0-9a-fA-F]+$/.test(addr);
  }
}