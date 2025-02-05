import { InstructionDecoder, AddressingMode } from './InstructionDecoder';

describe('InstructionDecoder', () => {
    let decoder: InstructionDecoder;

    beforeEach(() => {
        decoder = new InstructionDecoder();
    });

    describe('Instruction Parsing', () => {
        test('decoder.parse() handles all instruction formats', () => {
            // Test instruction format: [opcode(4)][addrA(2)][addrB(2)] = 8 bits
            // Example: MOV #1, @2
            // opcode = 0001 (MOV)
            // addrA = 00 (Immediate)
            // addrB = 10 (Indirect)
            const instruction = 0x12; // 0001 0010 in binary

            const decoded = decoder.parse(instruction);
            expect(decoded.opcode).toBe(1); // MOV
            expect(decoded.addressingModeA).toBe(AddressingMode.Immediate);
            expect(decoded.addressingModeB).toBe(AddressingMode.Indirect);
        });

        test('decoder.validate() catches invalid opcodes', () => {
            // Valid opcodes are 0-15 (4 bits)
            expect(decoder.validateOpcode(0)).toBe(true);
            expect(decoder.validateOpcode(15)).toBe(true);
            expect(decoder.validateOpcode(16)).toBe(false);
            expect(decoder.validateOpcode(-1)).toBe(false);
        });

        test('decoder.parse() throws on invalid addressing modes', () => {
            // Test each addressing mode position
            const instructions = [
                0x1C, // 0001 1100 - addrA = 3 (valid)
                0x13, // 0001 0011 - addrB = 3 (valid)
                0x18, // 0001 1000 - addrA = 2 (valid)
                0x12, // 0001 0010 - addrB = 2 (valid)
                0x14, // 0001 0100 - addrA = 1 (valid)
                0x11, // 0001 0001 - addrB = 1 (valid)
                0x10  // 0001 0000 - both = 0 (valid)
            ];

            // All these should parse successfully
            instructions.forEach(inst => {
                expect(() => decoder.parse(inst)).not.toThrow();
            });

            // Test invalid instruction formats
            expect(() => decoder.parse(0x100)).toThrow('Invalid instruction format'); // Extra bits set
            expect(() => decoder.parse(-1)).toThrow('Invalid instruction format'); // All bits set
            expect(() => decoder.parse(0xFF)).not.toThrow(); // Valid - all bits within 8-bit range
        });
    });

    describe('Address Resolution', () => {
        test('decoder.resolveAddress() handles all modes', () => {
            const pc = 0x1000;
            const value = 0x2000;

            // Immediate mode returns value directly
            expect(decoder.resolveAddress(AddressingMode.Immediate, value, pc))
                .toBe(value);

            // Direct mode returns value as address
            expect(decoder.resolveAddress(AddressingMode.Direct, value, pc))
                .toBe(value);

            // Indirect mode returns value (indirection handled by executor)
            expect(decoder.resolveAddress(AddressingMode.Indirect, value, pc))
                .toBe(value);

            // Indexed mode adds to PC and wraps
            expect(decoder.resolveAddress(AddressingMode.Indexed, 0xF000, pc))
                .toBe(0x0000); // 0x1000 + 0xF000 = 0x10000, wraps to 0x0000
        });

        test('decoder.resolveAddress() wraps addresses correctly', () => {
            const pc = 0xFFFF;

            // Adding 1 to 0xFFFF should wrap to 0x0000
            expect(decoder.resolveAddress(AddressingMode.Indexed, 1, pc))
                .toBe(0x0000);

            // Adding 2 to 0xFFFF should wrap to 0x0001
            expect(decoder.resolveAddress(AddressingMode.Indexed, 2, pc))
                .toBe(0x0001);
        });

        test('decoder.resolveAddress() throws on invalid mode', () => {
            expect(() => decoder.resolveAddress(99 as AddressingMode, 0, 0))
                .toThrow('Invalid addressing mode');
        });
    });
});