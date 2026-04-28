"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const main_1 = require("../main");
function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}
const describe = (name, fn) => {
    console.log(`Running suite: ${name}`);
    fn();
};
const it = (name, fn) => {
    console.log(`  Testing: ${name}`);
    try {
        fn();
        console.log(`    ✅ PASSED`);
    }
    catch (e) {
        console.error(`    ❌ FAILED: ${e.message}`);
        throw e;
    }
};
const expect = (actual) => ({
    toBe: (expected) => {
        if (actual !== expected) {
            throw new Error(`Expected ${expected} but got ${actual}`);
        }
    },
});
describe('Parser Full Flow: Symbol Resolution', () => {
    it('should replace symbols with their resolved addresses', () => {
        const source = `
      start:
        mov r0, 1
        jmp start
    `;
        const result = (0, main_1.parse)(source);
        const addrToken = result.tokens.find(t => t.value === '0');
        assert(addrToken !== undefined, 'resolved address 0 should exist');
        assert(addrToken.type === 'Immediate', 'resolved symbol should be an Immediate');
    });
    it('should report error for undefined symbols', () => {
        const source = `
      mov r0, undefined_label
    `;
        const result = (0, main_1.parse)(source);
        assert(result.errors.length > 0, 'should have errors for undefined symbol');
        assert(result.errors[0].message.includes('Undefined symbol: undefined_label'), 'error message should mention the symbol');
    });
    it('should resolve memory access symbols', () => {
        const source = `
      data_label:
        db 0x42
      mov r0, [data_label]
    `;
        const result = (0, main_1.parse)(source);
        const immToken = result.tokens.find(t => t.value === '0');
        assert(immToken !== undefined, 'resolved address in memory access should exist');
        assert(immToken.type === 'Immediate', 'resolved symbol in memory access should be Immediate');
    });
    it('should resolve memory access with offset', () => {
        const source = `
      data_label:
        db 0, 0, 0
      mov r0, [data_label + 2]
    `;
        const result = (0, main_1.parse)(source);
        const addrToken = result.tokens.find(t => t.value === '0');
        const offsetToken = result.tokens.find(t => t.value === '2');
        assert(addrToken !== undefined, 'base address should be resolved');
        assert(offsetToken !== undefined, 'offset should be preserved');
    });
    it('should report error for malformed memory access', () => {
        const source = `
      mov r0, [r0 + ]
    `;
        const result = (0, main_1.parse)(source);
        assert(result.errors.length > 0, 'should report error for missing offset');
    });
});
describe('Parser Full Flow: Address Calculation', () => {
    it('should handle .org', () => {
        const source = `
      .org 0x200
      label1:
        nop
    `;
        const result = (0, main_1.parse)(source);
        expect(result.symbols['label1']).toBe(0x200);
    });
    it('should handle DB/DW for address calculation', () => {
        const source = `
      start:
        db 1, 2, 3
        dw 0x1000, 0x2000
        label2:
        nop
    `;
        const result = (0, main_1.parse)(source);
        expect(result.symbols['start']).toBe(0);
        expect(result.symbols['label2']).toBe(7);
    });
    it('should handle equ directive', () => {
        const source = `
      CONST_VAL equ 0x10
      mov r0, CONST_VAL
    `;
        const result = (0, main_1.parse)(source);
        expect(result.symbols['CONST_VAL']).toBe(0x10);
        const valToken = result.tokens.find(t => t.value === '16');
        assert(valToken !== undefined, 'equ value should be resolved to immediate');
    });
});
describe('Parser Full Flow: Edge Cases', () => {
    it('should handle empty source', () => {
        const result = (0, main_1.parse)('');
        assert(result.tokens.length === 0, 'tokens should be empty');
        assert(result.errors.length === 0, 'errors should be empty');
    });
    it('should handle source with only comments', () => {
        const result = (0, main_1.parse)('; this is a comment\n; another one');
        assert(result.tokens.length === 0, 'tokens should be empty');
    });
    it('should resolve forward references', () => {
        const source = `
      jmp target
      target:
        nop
    `;
        const result = (0, main_1.parse)(source);
        const addrToken = result.tokens.find(t => t.value === '1'); // 'jmp' is size 3, but it starts at 0. target is at 3. Wait, jmp is 3 bytes.
        // Let's check. jmp is 3 bytes. So target is at address 3.
        const targetToken = result.tokens.find(t => t.value === '3');
        assert(targetToken !== undefined, 'forward reference should be resolved to address 3');
    });
});
