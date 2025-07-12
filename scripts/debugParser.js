import { AssemblyParser } from '../dist/parser/AssemblyParser.js';
import { CodeGenerator } from '../dist/parser/CodeGenerator.js';
import fs from 'fs';

// Debug the parser and code generation
const code = fs.readFileSync('./bots/test_jumps.asm', 'utf-8');
const parser = new AssemblyParser();
const result = parser.parse(code);

console.log('=== PARSE RESULT ===');
console.log('Errors:', result.errors);
console.log('\n=== SYMBOLS ===');
Object.entries(result.symbols).forEach(([name, addr]) => {
  console.log(`${name}: 0x${addr.toString(16)}`);
});

console.log('\n=== TOKENS ===');
result.tokens.forEach((token, i) => {
  console.log(`${i}: ${token.type} - ${token.value}`);
});

// Generate code
const codeGen = new CodeGenerator();
const instructions = codeGen.encode(result.tokens, result.symbols);
console.log('\n=== INSTRUCTIONS ===');
instructions.forEach((inst, i) => {
  console.log(`${i}: opcode=0x${inst.opcode.toString(16)}, operands=[${inst.operands.map(op => '0x' + op.toString(16)).join(', ')}], size=${inst.size}`);
});

const generatedCode = codeGen.layout(instructions, result.symbols);
console.log('\n=== GENERATED CODE ===');
console.log('Entry point:', '0x' + generatedCode.entryPoint.toString(16));
generatedCode.segments.forEach(seg => {
  console.log(`Segment ${seg.name}: start=0x${seg.start.toString(16)}, size=${seg.size}`);
  console.log('Data:', Array.from(seg.data).map(b => b.toString(16).padStart(2, '0')).join(' '));
});