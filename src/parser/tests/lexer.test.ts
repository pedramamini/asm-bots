import { tokenize } from '../lexer';

function assertTokens(source: string, expected: any[]) {
  const result = tokenize(source);
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    throw new Error(`Lexer failed!\nSource: ${source}\nExpected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(result)}`);
  }
  console.log(`PASSED: ${source}`);
}

try {
  console.log('Running Lexer Tests...');

  assertTokens('mov ax, 10', [
    { type: 'Instruction', value: 'mov', line: 1 },
    { type: 'Register', value: 'r0', line: 1 },
    { type: 'Punctuation', value: ',', line: 1 },
    { type: 'Immediate', value: '10', line: 1 },
  ]);

  assertTokens('mov r0, [bx + 0x10]', [
    { type: 'Instruction', value: 'mov', line: 1 },
    { type: 'Register', value: 'r0', line: 1 },
    { type: 'Punctuation', value: ',', line: 1 },
    { type: 'Punctuation', value: '[', line: 1 },
    { type: 'Register', value: 'r1', line: 1 },
    { type: 'Punctuation', value: '+', line: 1 },
    { type: 'Immediate', value: '0x10', line: 1 },
    { type: 'Punctuation', value: ']', line: 1 },
  ]);

  assertTokens('.name "Hunter"', [
    { type: 'Directive', value: '.name', line: 1 },
    { type: 'StringLiteral', value: '"Hunter"', line: 1 },
  ]);

  assertTokens('start: mov ax, bx', [
    { type: 'Symbol', value: 'start', line: 1 },
    { type: 'Punctuation', value: ':', line: 1 },
    { type: 'Instruction', value: 'mov', line: 1 },
    { type: 'Register', value: 'r0', line: 1 },
    { type: 'Punctuation', value: ',', line: 1 },
    { type: 'Register', value: 'r1', line: 1 },
  ]);

  assertTokens('jmp $ - 2', [
    { type: 'Instruction', value: 'jmp', line: 1 },
    { type: 'Symbol', value: '$', line: 1 },
    { type: 'Punctuation', value: '-', line: 1 },
    { type: 'Immediate', value: '2', line: 1 },
  ]);
} catch (e) {
  console.error(e);
}
