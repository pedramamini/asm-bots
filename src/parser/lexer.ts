import { Token, TokenType } from './types';

const REGISTER_MAP: Record<string, string> = {
  'ax': 'r0',
  'bx': 'r1',
  'si': 'r1',
  'cx': 'r2',
  'di': 'r2',
  'dx': 'r3',
  'sp': 'sp',
  'pc': 'pc',
  'flags': 'flags',
  'r0': 'r0',
  'r1': 'r1',
  'r2': 'r2',
  'r3': 'r3',
};

const INSTRUCTIONS = new Set([
  'mov', 'add', 'sub', 'mul', 'div',
  'jmp', 'jz', 'jnz', 'je', 'jne', 'jl', 'jg', 'jge', 'jle',
  'push', 'pop', 'call', 'ret',
  'and', 'or', 'xor', 'not',
  'inc', 'dec', 'nop', 'halt',
  'cmp', 'spl', 'dat',
  'test', 'lea', 'xchg',
  'db', 'dw', 'dq',
  'word' // Accepted as a no-op modifier per spec
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i];

    // Remove comments
    const commentIndex = line.indexOf(';');
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex);
    }

    let cursor = 0;
    while (cursor < line.length) {
      const char = line[cursor];

      // Skip whitespace
      if (/\s/.test(char)) {
        cursor++;
        continue;
      }

      // Punctuation
      if ([':', ',', '[', ']', '+', '-'].includes(char)) {
        tokens.push({ type: 'Punctuation', value: char, line: lineNum });
        cursor++;
        continue;
      }

      // String Literal
      if (char === '"') {
        let value = '"';
        cursor++;
        while (cursor < line.length && line[cursor] !== '"') {
          value += line[cursor];
          cursor++;
        }
        if (cursor < line.length) {
          value += '"';
          cursor++;
        }
        tokens.push({ type: 'StringLiteral', value, line: lineNum });
        continue;
      }

      // Directive
      if (char === '.') {
        let value = '.';
        cursor++;
        while (cursor < line.length && /[a-zA-Z0-9_]/.test(line[cursor])) {
          value += line[cursor];
          cursor++;
        }
        tokens.push({ type: 'Directive', value: value.toLowerCase(), line: lineNum });
        continue;
      }

      // Hex with $ (Handle $FF as immediate, $ as current address symbol)
      if (char === '$') {
        if (cursor + 1 < line.length && /[0-9a-fA-F]/.test(line[cursor + 1])) {
          let value = '$';
          cursor++;
          while (cursor < line.length && /[0-9a-fA-F]/.test(line[cursor])) {
            value += line[cursor++];
          }
          tokens.push({ type: 'Immediate', value, line: lineNum });
        } else {
          tokens.push({ type: 'Symbol', value: '$', line: lineNum });
          cursor++;
        }
        continue;
      }

      // Numbers (Immediate)
      if (/[0-9\-]/.test(char)) {
        let value = '';
        if (char === '-') {
          value += '-';
          cursor++;
          if (cursor >= line.length || !/[0-9]/.test(line[cursor])) {
             tokens.push({ type: 'Punctuation', value: '-', line: lineNum });
             continue;
          }
        }
        
        if (cursor < line.length && line[cursor] === '0' && line[cursor+1] === 'x') {
          value += '0x';
          cursor += 2;
          while (cursor < line.length && /[0-9a-fA-F]/.test(line[cursor])) {
            value += line[cursor++];
          }
        } else {
          while (cursor < line.length && /[0-9]/.test(line[cursor])) {
            value += line[cursor++];
          }
        }
        tokens.push({ type: 'Immediate', value, line: lineNum });
        continue;
      }

      // Identifiers (Labels, Instructions, Registers, Symbols)
      if (/[a-zA-Z_]/.test(char)) {
        let value = '';
        while (cursor < line.length && /[a-zA-Z0-9_]/.test(line[cursor])) {
          value += line[cursor++];
        }

        const lowerValue = value.toLowerCase();
        
        if (REGISTER_MAP[lowerValue]) {
          tokens.push({ type: 'Register', value: REGISTER_MAP[lowerValue], line: lineNum });
        } else if (INSTRUCTIONS.has(lowerValue) || lowerValue === 'equ') {
          tokens.push({ type: 'Instruction', value: lowerValue, line: lineNum });
        } else {
          // It's either a Label or a Symbol. 
          // In a simple lexer, we can't distinguish without checking for the following ':'
          // But we can just emit it as a Symbol/Label and let the parser handle the ':'
          // However, the spec says Labels are case-sensitive.
          tokens.push({ type: 'Symbol', value, line: lineNum });
        }
        continue;
      }

      // Fallback for unknown characters
      cursor++;
    }
  }

  return tokens;
}
