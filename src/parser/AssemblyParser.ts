import { Token, TokenType, ParseError, ParseResult, SymbolTable } from './types.js';

export class AssemblyParser {
  private source: string = '';
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private symbols: SymbolTable = {};
  private currentAddress: number = 0;
  private botMetadata: { [key: string]: string } = {};

  // Valid instructions for our assembly language
  private static readonly VALID_INSTRUCTIONS = new Set([
    'mov', 'add', 'sub', 'mul', 'div',
    'jmp', 'jz', 'jnz', 'je', 'jne', 'jl', 'jg', 'jge', 'jle',
    'push', 'pop', 'call', 'ret',
    'and', 'or', 'xor', 'not',
    'inc', 'dec', 'nop', 'halt',
    'cmp', 'spl', 'dat',
    'test', 'lea', 'xchg'
  ]);

  // Valid registers
  private static readonly VALID_REGISTERS = new Set([
    'r0', 'r1', 'r2', 'r3',
    'sp', 'pc', 'flags',
    'ax', 'bx', 'cx', 'dx',  // Add x86-style registers
    'si', 'di'              // Additional index registers
  ]);
  
  // Valid directives
  private static readonly VALID_DIRECTIVES = new Set([
    '.name', '.author', '.version', '.strategy',
    '.code', '.data', '.const', '.org',
    '.align', '.space', '.include'
  ]);
  
  // Valid data definitions
  private static readonly VALID_DATA_DEFS = new Set([
    'db', 'dw', 'equ', 'dq'
  ]);
  
  // Valid colon-style label data definitions
  private static readonly VALID_DATA_LABELS = new Set([
    'step:', 'bomb:', 'dart:', 'code_size', 'trap:', 'dat:'
  ]);

  tokenize(source: string): Token[] {
    this.source = source;
    this.tokens = [];
    this.errors = [];
    this.symbols = {};
    this.botMetadata = {};
    this.currentAddress = 0;

    const lines = source.split('\n');
    const lineAddresses = new Map<number, number>();
    const labelLines = new Set<number>();

    // First pass: collect labels, directives, and calculate addresses
    let addr = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const rawLine = lines[lineNum];
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith(';')) {
        continue;
      }

      const currentLineNum = lineNum + 1;
      lineAddresses.set(currentLineNum, addr);

      if (line.endsWith(':')) {
        // Handle label
        const label = line.slice(0, -1).trim();
        if (this.validateIdentifier(label)) {
          this.symbols[label] = addr;
          labelLines.add(currentLineNum);
        } else if (AssemblyParser.VALID_DATA_LABELS.has(line)) {
          // Handle data label like step: dw 0x37
          const parts = line.split(/\s+/);
          if (parts.length > 1) {
            const dataType = parts[1].toLowerCase();
            if (AssemblyParser.VALID_DATA_DEFS.has(dataType)) {
              const label = parts[0].slice(0, -1); // Remove colon
              this.symbols[label] = addr;
              addr++;  // Increment address for data definition
            }
          }
        }
      } else {
        // Parse directive, data definition, or instruction
        let parts = this.splitLine(line);
        if (parts.length === 0) continue;

        const firstToken = parts[0].toLowerCase();

        // Handle directives (starting with .)
        if (firstToken.startsWith('.')) {
          if (AssemblyParser.VALID_DIRECTIVES.has(firstToken)) {
            // Parse metadata directives
            if (firstToken === '.name' || firstToken === '.author' || 
                firstToken === '.version' || firstToken === '.strategy') {
              if (parts.length > 1) {
                const metadataValue = this.extractQuotedString(rawLine);
                this.botMetadata[firstToken.substring(1)] = metadataValue || parts[1];
              }
            }
            // Don't increment address for directives
          } else {
            this.errors.push({
              message: `Invalid directive: ${firstToken}`,
              line: currentLineNum
            });
          }
        } 
        // Handle data definitions
        else if (AssemblyParser.VALID_DATA_DEFS.has(firstToken)) {
          // Calculate size of data (estimate for now)
          if (firstToken === 'dw') {
            addr += parts.length - 1; // Each word is 1 address unit for our simple model
          } else if (firstToken === 'db') {
            addr += Math.ceil((parts.length - 1) / 2); // Estimate bytes to words
          }
          // For equ, don't increment address
        }
        // Handle instructions
        else if (AssemblyParser.VALID_INSTRUCTIONS.has(firstToken)) {
          addr++;
        } else {
          this.errors.push({
            message: `Invalid instruction: ${firstToken}`,
            line: currentLineNum
          });
        }
      }
    }

    // Second pass: tokenize instructions and operands
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const rawLine = lines[lineNum];
      const line = rawLine.trim();

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
          
          // Check if this is a data label (e.g., "step: dw 0x37")
          if (AssemblyParser.VALID_DATA_LABELS.has(line)) {
            const parts = line.split(/\s+/);
            if (parts.length > 1) {
              const dataLabel = parts[0].slice(0, -1); // Remove colon
              // Add label token
              this.tokens.push({
                type: TokenType.Label,
                value: dataLabel,
                line: currentLineNum
              });
              
              // Add the data definition token
              if (parts.length > 1 && AssemblyParser.VALID_DATA_DEFS.has(parts[1].toLowerCase())) {
                this.tokens.push({
                  type: TokenType.DataDefinition,
                  value: parts[1].toLowerCase(),
                  line: currentLineNum
                });
                
                // Add any remaining values as operands
                for (let i = 2; i < parts.length; i++) {
                  this.tokenizeOperand(parts[i], currentLineNum);
                }
              }
            }
          }
          // Normal label
          else if (this.validateIdentifier(label)) {
            this.tokens.push({
              type: TokenType.Label,
              value: label,
              line: currentLineNum
            });
          }
        } else {
          // Split line into parts
          const parts = this.splitLine(line);
          if (parts.length === 0) continue;
          
          const firstToken = parts[0].toLowerCase();

          // Handle code_size equ pattern
          if (firstToken === 'code_size' && parts.length > 2 && parts[1].toLowerCase() === 'equ') {
            // This is a special pattern for calculating code size
            // Just add a placeholder value
            this.symbols['code_size'] = 100; // Placeholder value
            this.tokens.push({
              type: TokenType.Label,
              value: 'code_size',
              line: currentLineNum
            });
            this.tokens.push({
              type: TokenType.DataDefinition,
              value: 'equ',
              line: currentLineNum
            });
            this.tokens.push({
              type: TokenType.Immediate,
              value: '100',
              line: currentLineNum
            });
          }
          // Handle directives
          else if (firstToken.startsWith('.')) {
            if (AssemblyParser.VALID_DIRECTIVES.has(firstToken)) {
              this.tokens.push({
                type: TokenType.Directive,
                value: firstToken,
                line: currentLineNum
              });
              
              if (parts.length > 1) {
                if (firstToken === '.name' || firstToken === '.author' || 
                    firstToken === '.version' || firstToken === '.strategy') {
                  // Handle quoted string
                  const stringValue = this.extractQuotedString(rawLine);
                  if (stringValue) {
                    this.tokens.push({
                      type: TokenType.StringLiteral,
                      value: stringValue,
                      line: currentLineNum
                    });
                  } else {
                    this.tokenizeOperand(parts[1], currentLineNum);
                  }
                } else {
                  // Handle other directive parameters
                  for (let i = 1; i < parts.length; i++) {
                    this.tokenizeOperand(parts[i], currentLineNum);
                  }
                }
              }
            }
          }
          // Handle data definitions
          else if (AssemblyParser.VALID_DATA_DEFS.has(firstToken)) {
            this.tokens.push({
              type: TokenType.DataDefinition,
              value: firstToken,
              line: currentLineNum
            });
            
            // Handle data values
            for (let i = 1; i < parts.length; i++) {
              if (parts[i].startsWith('"')) {
                // String data
                const stringValue = this.extractQuotedString(rawLine, parts.slice(0, i).join(' ').length);
                if (stringValue) {
                  this.tokens.push({
                    type: TokenType.StringLiteral,
                    value: stringValue,
                    line: currentLineNum
                  });
                  break; // Stop after string
                }
              } else {
                // Numeric data or symbol
                this.tokenizeOperand(parts[i], currentLineNum);
              }
            }
          }
          // Handle instructions
          else if (AssemblyParser.VALID_INSTRUCTIONS.has(firstToken)) {
            this.tokens.push({
              type: TokenType.Instruction,
              value: firstToken,
              line: currentLineNum
            });
            
            // Parse operands
            for (let i = 1; i < parts.length; i++) {
              const operand = parts[i].trim();
              if (operand) {
                this.tokenizeOperand(operand, currentLineNum);
              }
            }
          } else {
            this.errors.push({
              message: `Invalid instruction: ${firstToken}`,
              line: currentLineNum
            });
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
  
  // Helper to extract a quoted string from a line
  private extractQuotedString(line: string, startPos: number = 0): string | null {
    const quoteStart = line.indexOf('"', startPos);
    if (quoteStart >= 0) {
      const quoteEnd = line.indexOf('"', quoteStart + 1);
      if (quoteEnd >= 0) {
        return line.substring(quoteStart + 1, quoteEnd);
      }
    }
    return null;
  }
  
  // Split a line into tokens, respecting quotes and brackets
  private splitLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let inBrackets = false;
    
    // Remove comments
    const commentPos = line.indexOf(';');
    const cleanLine = commentPos >= 0 ? line.substring(0, commentPos) : line;
    
    for (let i = 0; i < cleanLine.length; i++) {
      const char = cleanLine[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === '[') {
        inBrackets = true;
        current += char;
      } else if (char === ']') {
        inBrackets = false;
        current += char;
      } else if ((char === ' ' || char === '\t' || char === ',') && !inQuotes && !inBrackets) {
        if (current) {
          result.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      result.push(current);
    }
    
    return result;
  }

  private tokenizeOperand(operand: string, lineNum: number): void {
    // Memory access syntax [register] or [register+offset]
    if (operand.startsWith('[') && operand.endsWith(']')) {
      const memContents = operand.slice(1, -1).trim();
      this.tokens.push({
        type: TokenType.MemoryAccess,
        value: memContents,
        line: lineNum
      });
      
      // Parse inner expression for better validation
      if (memContents.includes('+')) {
        // Indexed addressing [reg+offset]
        const parts = memContents.split('+').map(p => p.trim());
        if (parts.length === 2) {
          const reg = parts[0].toLowerCase();
          const offset = parts[1];
          
          if (!AssemblyParser.VALID_REGISTERS.has(reg)) {
            this.errors.push({
              message: `Invalid register in memory access: ${reg}`,
              line: lineNum
            });
          }
          
          if (!this.validateNumber(offset) && !this.validateIdentifier(offset)) {
            this.errors.push({
              message: `Invalid offset in memory access: ${offset}`,
              line: lineNum
            });
          }
        }
      } else {
        // Simple memory access [reg]
        if (!AssemblyParser.VALID_REGISTERS.has(memContents.toLowerCase()) && 
            !this.validateNumber(memContents) && 
            !this.validateIdentifier(memContents)) {
          this.errors.push({
            message: `Invalid memory reference: ${memContents}`,
            line: lineNum
          });
        }
      }
      return;
    }
    
    // Immediate value with # prefix
    if (operand.startsWith('#')) {
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
      return;
    } 
    
    // Hexadecimal values with 0x prefix or $ prefix
    if (operand.startsWith('0x') || operand.startsWith('$')) {
      const value = operand.startsWith('$') ? operand.slice(1) : operand.slice(2);
      if (!this.validateHexAddress(value)) {
        this.errors.push({
          message: `Invalid hexadecimal value: ${value}`,
          line: lineNum
        });
        return;
      }
      this.tokens.push({
        type: TokenType.Immediate,
        value: operand,
        line: lineNum
      });
      return;
    }
    
    // Decimal numbers
    if (/^-?\d+$/.test(operand)) {
      this.tokens.push({
        type: TokenType.Immediate,
        value: operand,
        line: lineNum
      });
      return;
    }
    
    // Register
    if (AssemblyParser.VALID_REGISTERS.has(operand.toLowerCase())) {
      this.tokens.push({
        type: TokenType.Register,
        value: operand.toLowerCase(),
        line: lineNum
      });
      return;
    }
    
    // Symbol reference (label)
    if (this.validateIdentifier(operand)) {
      this.tokens.push({
        type: TokenType.Symbol,
        value: operand,
        line: lineNum
      });
      return;
    }
    
    // If we got here, it's an invalid operand
    this.errors.push({
      message: `Invalid operand: ${operand}`,
      line: lineNum
    });
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