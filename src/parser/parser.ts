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

    if (token.type === 'Symbol' && i + 1 < tokens.length && tokens[i + 1].type === 'Punctuation' && tokens[i + 1].value === ':') {
      symbols[token.value] = currentAddress;
      i += 2;
      continue;
    }

    if (token.type === 'Directive') {
      if (token.value === '.org' && i + 1 < tokens.length && tokens[i + 1].type === 'Immediate') {
        currentAddress = parseImmediate(tokens[i + 1].value);
        i += 2;
      } else if (['.name', '.author', '.version', '.strategy'].includes(token.value)) {
        i++;
        while (i < tokens.length && tokens[i].line === token.line && (tokens[i].type === 'Symbol' || tokens[i].type === 'StringLiteral')) {
          i++;
        }
      } else if (token.value === '.code') {
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (token.type === 'Instruction' && token.value.toLowerCase() === 'equ') {
      if (i + 1 < tokens.length) {
        const symbolToken = tokens[i - 1];
        if (symbolToken && symbolToken.type === 'Symbol') {
          const valueToken = tokens[i + 1];
          if (!valueToken) {
            i++;
            continue;
          }
          if (valueToken.type === 'Immediate') {
            symbols[symbolToken.value] = parseImmediate(valueToken.value);
          } else if (valueToken.type === 'Symbol' && valueToken.value === '$') {
            symbols[symbolToken.value] = currentAddress;
          } else if (valueToken.type === 'Punctuation' && valueToken.value === '$') {
            symbols[symbolToken.value] = currentAddress;
          } else if (valueToken.type === 'Symbol') {
            symbols[symbolToken.value] = symbols[valueToken.value] || 0;
          } else if (valueToken.type === 'Punctuation' && valueToken.value === '-') {
            if (i + 2 < tokens.length && (tokens[i + 2].type === 'Symbol' || tokens[i + 2].type === 'Immediate')) {
              const nextToken = tokens[i + 2];
              const val = nextToken.type === 'Immediate' ? parseImmediate(nextToken.value) : (symbols[nextToken.value] || 0);
              symbols[symbolToken.value] = -val;
            } else {
              symbols[symbolToken.value] = 0;
            }
          } else {
            symbols[symbolToken.value] = 0;
          }
        }
      }
      i++;
      continue;
    }

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

export function secondPass(tokens: Token[], symbols: Record<string, number>): { resolvedTokens: Token[], errors: { message: string, line: number }[] } {
  const resolvedTokens: Token[] = [];
  const errors: { message: string, line: number }[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === 'Directive') {
      resolvedTokens.push(token);
      i++;
      while (i < tokens.length && tokens[i].line === token.line && (tokens[i].type === 'Symbol' || tokens[i].type === 'StringLiteral' || tokens[i].type === 'Immediate')) {
        resolvedTokens.push(tokens[i]);
        i++;
      }
      continue;
    }

    if (token.type === 'Instruction' && token.value.toLowerCase() === 'equ') {
      i++;
      while (i < tokens.length && tokens[i].line === token.line) {
        i++;
      }
      continue;
    }

    if (token.type === 'Instruction' || token.type === 'Register' || token.type === 'Immediate' || token.type === 'Punctuation') {
      resolvedTokens.push(token);
      i++;
      continue;
    }

    if (token.type === 'Symbol') {

    }

    if (token.type === 'Punctuation' && token.value === '[') {
      resolvedTokens.push(token);
      i++;
      
      if (i < tokens.length && (tokens[i].type === 'Register' || tokens[i].type === 'Immediate' || tokens[i].type === 'Symbol')) {
        const op1 = tokens[i];
        if (op1.type === 'Symbol' && symbols.hasOwnProperty(op1.value)) {
          resolvedTokens.push({ type: 'Immediate', value: symbols[op1.value].toString(), line: op1.line });
        } else if (op1.type === 'Symbol') {
          resolvedTokens.push(op1);
          errors.push({ message: `Undefined symbol in memory access: ${op1.value}`, line: op1.line });
        } else {
          resolvedTokens.push(op1);
        }
        i++;

        if (i < tokens.length && tokens[i].type === 'Punctuation' && tokens[i].value === '+') {
          resolvedTokens.push(tokens[i]);
          i++;
          if (i < tokens.length && (tokens[i].type === 'Immediate' || tokens[i].type === 'Symbol')) {
            const op2 = tokens[i];
            if (op2.type === 'Symbol' && symbols.hasOwnProperty(op2.value)) {
              resolvedTokens.push({ type: 'Immediate', value: symbols[op2.value].toString(), line: op2.line });
            } else if (op2.type === 'Symbol') {
              resolvedTokens.push(op2);
              errors.push({ message: `Undefined symbol in memory access offset: ${op2.value}`, line: op2.line });
            } else {
              resolvedTokens.push(op2);
            }
            i++;
          } else {
            errors.push({ message: `Expected immediate or symbol after '+' in memory access`, line: token.line });
          }
        }
      } else {
        errors.push({ message: `Expected register, immediate, or symbol after '['`, line: token.line });
      }

      if (i < tokens.length && tokens[i].type === 'Punctuation' && tokens[i].value === ']') {
        resolvedTokens.push(tokens[i]);
        i++;
      } else {
        errors.push({ message: `Expected ']' to close memory access`, line: token.line });
      }
      continue;
    }

    resolvedTokens.push(token);
    i++;
  }

  return { resolvedTokens, errors };
}
