import { Token, TokenType, ParseResult } from './types';

const INSTRUCTION_SIZES: Record<string, number> = {
  'nop': 1,
  'halt': 1,
  'ret': 1,
  'inc': 2,
  'dec': 2,
  'not': 2,
  'push': 2,
  'pop': 2,
  'mov': 3,
  'add': 3,
  'sub': 3,
  'mul': 3,
  'div': 3,
  'and': 3,
  'or': 3,
  'xor': 3,
  'jmp': 3,
  'jz': 3,
  'jnz': 3,
  'je': 3,
  'jne': 3,
  'jl': 3,
  'jg': 3,
  'jge': 3,
  'jle': 3,
  'call': 3,
  'spl': 3,
  'cmp': 3,
  'test': 3,
  'lea': 3,
  'xchg': 3,
  'dat': 3,
};

export function firstPass(tokens: Token[]): { symbols: Record<string, number>, currentAddress: number } {
  const symbols: Record<string, number> = {};
  let currentAddress = 0;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Handle Labels: symbol followed by ':'
    if (token.type === 'Symbol' && i + 1 < tokens.length && tokens[i + 1].type === 'Punctuation' && tokens[i + 1].value === ':') {
      symbols[token.value] = currentAddress;
      i += 2;
      continue;
    }

    // Handle the $ symbol as a symbol
    if (token.type === 'Symbol' && token.value === '$') {
       // $ is usually used in equ or labels, so we handle it as 
       // the current address. In a simple pass, we can just treat it 
       // as the current address for equ calculations.
       // However, in the way we've structured firstPass, $ is usually
       // part of a larger expression in equ.
       // To fully support `equ $ - start`, we'd need an expression evaluator.
       // For now, let's just ensure we don't crash.
    }

    // Handle Directives
    if (token.type === 'Directive') {
      if (token.value === '.org' && i + 1 < tokens.length && tokens[i + 1].type === 'Immediate') {
        currentAddress = parseImmediate(tokens[i + 1].value);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Handle Equates: symbol 'equ' value
    if (token.type === 'Symbol' && i + 1 < tokens.length && tokens[i + 1].type === 'Symbol' && tokens[i + 1].value.toLowerCase() === 'equ') {
      if (i + 2 < tokens.length) {
        const valueToken = tokens[i + 2];
        if (valueToken.type === 'Immediate') {
          symbols[token.value] = parseImmediate(valueToken.value);
        } else if (valueToken.type === 'Symbol') {
          // Handle simple symbol-to-symbol equ
          symbols[token.value] = symbols[valueToken.value] || 0;
        }
      }
      i += 3;
      continue;
    }

    // Handle Instructions
    if (token.type === 'Instruction') {
      const op = token.value.toLowerCase();
      if (op === 'db' || op === 'dw' || op === 'dq') {
        const sizePerElement = op === 'db' ? 1 : op === 'dw' ? 2 : 4;
        let elements = 0;
        let j = i + 1;
        while (j < tokens.length && tokens[j].line === token.line) {
          if (tokens[j].type === 'Immediate' || tokens[j].type === 'StringLiteral' || tokens[j].type === 'Symbol') {
            elements++;
          }
          j++;
        }
        currentAddress += elements * sizePerElement;
        i = j;
      } else {
        const size = INSTRUCTION_SIZES[op] || 1;
        currentAddress += size;
        i++;
        // Skip operands on the same line
        while (i < tokens.length && tokens[i].line === token.line) {
          i++;
        }
      }
      continue;
    }

    i++;
  }

  return { symbols, currentAddress };
}

function parseImmediate(val: string): number {
  if (val.startsWith('0x')) {
    return parseInt(val.substring(2), 16);
  }
  return parseInt(val, 10);
}
