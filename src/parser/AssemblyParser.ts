import { Token, TokenType, ParseError, ParseResult, SymbolTable } from './types.js';

export class AssemblyParser {
  private source: string = '';
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private symbols: SymbolTable = {};
  private botMetadata: { [key: string]: string } = {};
  private currentAddress: number = 0;
  private inDataSection: boolean = false;

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
    'si', 'di', 'word'       // Additional index registers and modifiers
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

  // Some symbols to initialize with default values
  private static readonly PREDEFINED_SYMBOLS: { [key: string]: number } = {
    'defense_start': 0x300,
    '$': 0, // Special $ symbol for current address
  };

  public parse(source: string): ParseResult {
    this.reset();
    this.source = source;
    
    // First pass to collect labels, directives, and symbols
    this.collectSymbols();
    
    // Second pass to tokenize the code
    this.tokenize();
    
    // Return the parse result
    return {
      tokens: this.tokens,
      errors: this.errors,
      symbols: this.symbols
    };
  }

  private reset(): void {
    this.tokens = [];
    this.errors = [];
    this.symbols = { ...AssemblyParser.PREDEFINED_SYMBOLS };
    this.botMetadata = {};
    this.currentAddress = 0;
    this.inDataSection = false;
  }

  private collectSymbols(): void {
    const lines = this.source.split('\n');
    let currentAddress = 0;
    
    // Track the start label for code_size calculation
    let startLabelAddress = 0;
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith(';')) {
        continue;
      }
      
      // Store the $ symbol's current value
      this.symbols['$'] = currentAddress;
      
      // Handle label declarations (ending with :)
      if (line.endsWith(':')) {
        const label = line.slice(0, -1).trim();
        if (this.validateIdentifier(label)) {
          this.symbols[label] = currentAddress;
          
          // If this is the 'start' label, remember its address
          if (label === 'start') {
            startLabelAddress = currentAddress;
          }
        }
      }
      // Handle directives
      else if (line.startsWith('.')) {
        const parts = this.splitLine(line);
        const directive = parts[0].toLowerCase();
        
        // Section directives can affect address
        if (directive === '.code') {
          this.inDataSection = false;
        } else if (directive === '.data' || directive === '.const') {
          this.inDataSection = true;
        }
        // Handle metadata directives
        else if (directive === '.name' || directive === '.author' || 
                directive === '.version' || directive === '.strategy') {
          if (parts.length > 1) {
            const metadataValue = this.extractQuotedString(line);
            this.botMetadata[directive.substring(1)] = metadataValue || parts[1];
          }
        }
      }
      // Handle data definitions
      else if (!line.startsWith(';')) { // Not a comment
        const parts = this.splitLine(line);
        if (parts.length >= 2) {
          // Check for data definitions like "trap: dw 0xAAAA"
          if (parts[0].endsWith(':') && parts.length > 2) {
            const label = parts[0].slice(0, -1).trim();
            if (this.validateIdentifier(label)) {
              this.symbols[label] = currentAddress;
              const defType = parts[1].toLowerCase();
              if (AssemblyParser.VALID_DATA_DEFS.has(defType)) {
                // For actual data allocations, increment address
                if (defType === 'dw' || defType === 'db' || defType === 'dq') {
                  currentAddress++;
                }
              }
            }
          }
          // Check for "name equ value" pattern
          else if (parts.length >= 3 && parts[1].toLowerCase() === 'equ') {
            const symbol = parts[0];
            if (this.validateIdentifier(symbol)) {
              // Special handling for "code_size equ $ - start"
              if (symbol === 'code_size' && parts[2] === '$' && parts.length >= 5 && parts[3] === '-' && parts[4] === 'start') {
                // Calculate the actual code size
                this.symbols[symbol] = currentAddress - startLabelAddress;
              }
              // Handle "defense_start equ 0x300" pattern
              else if (parts[2].startsWith('0x')) {
                this.symbols[symbol] = parseInt(parts[2].slice(2), 16);
              }
              // Other equ definitions
              else if (this.validateNumber(parts[2])) {
                this.symbols[symbol] = parseInt(parts[2], 0);
              }
            }
          }
          // Check for simple "name dw value" pattern
          else if (AssemblyParser.VALID_DATA_DEFS.has(parts[1].toLowerCase())) {
            const symbol = parts[0];
            if (this.validateIdentifier(symbol)) {
              this.symbols[symbol] = currentAddress;
              // For actual data allocations, increment address
              if (parts[1].toLowerCase() === 'dw' || parts[1].toLowerCase() === 'db' || parts[1].toLowerCase() === 'dq') {
                currentAddress++;
              }
            }
          }
          // Normal instructions increment address
          else if (AssemblyParser.VALID_INSTRUCTIONS.has(parts[0].toLowerCase())) {
            currentAddress++;
          }
        }
        // Single token lines might be instructions without operands
        else if (parts.length === 1 && AssemblyParser.VALID_INSTRUCTIONS.has(parts[0].toLowerCase())) {
          currentAddress++;
        }
      }
    }
  }

  private tokenize(): void {
    const lines = this.source.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      const currentLineNum = lineNum + 1;
      
      // Skip empty lines and comments
      if (!line || line.startsWith(';')) {
        continue;
      }
      
      try {
        // Handle labels (ending with :)
        if (line.endsWith(':')) {
          const label = line.slice(0, -1).trim();
          if (this.validateIdentifier(label)) {
            this.tokens.push({
              type: TokenType.Label,
              value: label,
              line: currentLineNum
            });
          }
        }
        // Handle directives
        else if (line.startsWith('.')) {
          this.tokenizeDirective(line, currentLineNum);
        }
        // Handle data definitions and instructions
        else {
          const parts = this.splitLine(line);
          if (parts.length === 0) continue;
          
          const firstToken = parts[0].toLowerCase();
          
          // Check for "name equ value" pattern (data definition)
          if (parts.length >= 3 && parts[1].toLowerCase() === 'equ') {
            this.tokens.push({
              type: TokenType.Label,
              value: parts[0],
              line: currentLineNum
            });
            
            this.tokens.push({
              type: TokenType.DataDefinition,
              value: 'equ',
              line: currentLineNum
            });
            
            // Special handling for "code_size equ $ - start" pattern
            if (parts[2] === '$' && parts.length >= 5 && parts[3] === '-' && parts[4] === 'start') {
              this.tokens.push({
                type: TokenType.Immediate,
                value: this.symbols['code_size'].toString(),
                line: currentLineNum
              });
            } else {
              // Normal value
              this.tokenizeOperand(parts[2], currentLineNum);
            }
          }
          // Check for "name dw value" pattern (data definition)
          else if (parts.length >= 2 && AssemblyParser.VALID_DATA_DEFS.has(parts[1].toLowerCase())) {
            this.tokens.push({
              type: TokenType.Label,
              value: parts[0],
              line: currentLineNum
            });
            
            this.tokens.push({
              type: TokenType.DataDefinition,
              value: parts[1].toLowerCase(),
              line: currentLineNum
            });
            
            // Add values
            for (let i = 2; i < parts.length; i++) {
              this.tokenizeOperand(parts[i], currentLineNum);
            }
          }
          // Normal instruction
          else if (AssemblyParser.VALID_INSTRUCTIONS.has(firstToken)) {
            this.tokens.push({
              type: TokenType.Instruction,
              value: firstToken,
              line: currentLineNum
            });
            
            // Tokenize operands
            for (let i = 1; i < parts.length; i++) {
              this.tokenizeOperand(parts[i], currentLineNum);
            }
          }
          else {
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
  }

  private tokenizeDirective(line: string, lineNum: number): void {
    const parts = this.splitLine(line);
    const directive = parts[0].toLowerCase();
    
    if (!AssemblyParser.VALID_DIRECTIVES.has(directive)) {
      this.errors.push({
        message: `Invalid directive: ${directive}`,
        line: lineNum
      });
      return;
    }
    
    this.tokens.push({
      type: TokenType.Directive,
      value: directive,
      line: lineNum
    });
    
    // Handle directive parameters
    if (parts.length > 1) {
      if (directive === '.name' || directive === '.author' || 
          directive === '.version' || directive === '.strategy') {
        // String value
        const stringValue = this.extractQuotedString(line);
        if (stringValue) {
          this.tokens.push({
            type: TokenType.StringLiteral,
            value: stringValue,
            line: lineNum
          });
        } else {
          // Just use the raw value
          this.tokenizeOperand(parts[1], lineNum);
        }
      } else {
        // Other directive parameters
        for (let i = 1; i < parts.length; i++) {
          this.tokenizeOperand(parts[i], lineNum);
        }
      }
    }
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
      return;
    }
    
    // Handle word prefix (for memory access)
    if (operand.toLowerCase() === 'word' && lineNum < this.tokens.length && this.tokens[this.tokens.length - 1].type === TokenType.Register) {
      // This is a modifier for the memory access, just ignore it
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
    
    // Special $ symbol (current address)
    if (operand === '$') {
      this.tokens.push({
        type: TokenType.Symbol, // Treat as a symbol for simplicity
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