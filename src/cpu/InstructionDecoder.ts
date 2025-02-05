/**
 * Core Wars Instruction Decoder
 * Handles opcode parsing, operand extraction, and addressing mode resolution
 */

export enum AddressingMode {
    Immediate, // Value is used directly
    Direct,    // Value is used as memory address
    Indirect,  // Value is used as pointer to memory address
    Indexed    // Value is added to program counter
}

export interface Instruction {
    opcode: number;
    addressingModeA: AddressingMode;
    operandA: number;
    addressingModeB: AddressingMode;
    operandB: number;
}

export class InstructionDecoder {
    // Instruction format: [opcode(4)][addrA(2)][addrB(2)]
    private static readonly OPCODE_MASK = 0xF0;      // 1111 0000
    private static readonly ADDR_MODE_A_MASK = 0x0C; // 0000 1100
    private static readonly ADDR_MODE_B_MASK = 0x03; // 0000 0011
    private static readonly VALID_INSTRUCTION_MASK = 0xFF; // 1111 1111

    /**
     * Parse a raw instruction into its components
     * @param instruction Raw instruction word
     * @returns Decoded instruction with opcode, addressing modes, and operands
     * @throws Error if instruction contains invalid addressing modes
     */
    public parse(instruction: number): Instruction {
        // Validate instruction format
        if ((instruction & ~InstructionDecoder.VALID_INSTRUCTION_MASK) !== 0) {
            throw new Error('Invalid instruction format: extra bits set');
        }

        const opcode = (instruction & InstructionDecoder.OPCODE_MASK) >> 4;
        const addrModeA = (instruction & InstructionDecoder.ADDR_MODE_A_MASK) >> 2;
        const addrModeB = instruction & InstructionDecoder.ADDR_MODE_B_MASK;

        // Validate addressing modes
        if (addrModeA > 3) {
            throw new Error(`Invalid addressing mode A: ${addrModeA}`);
        }
        if (addrModeB > 3) {
            throw new Error(`Invalid addressing mode B: ${addrModeB}`);
        }

        // Extract operands from next words
        return {
            opcode,
            addressingModeA: addrModeA,
            operandA: 0, // Will be set by executor
            addressingModeB: addrModeB,
            operandB: 0  // Will be set by executor
        };
    }

    /**
     * Validate an addressing mode value
     * @param mode Raw addressing mode value
     * @param label Label for error message
     * @throws Error if mode is invalid
     */
    private validateAddressingMode(mode: number, label: string): void {
        if (mode < 0 || mode > 3) {
            throw new Error(`Invalid addressing mode ${label}: ${mode}`);
        }
    }

    /**
     * Validate an opcode value
     * @param opcode Raw opcode value
     * @returns true if opcode is valid
     */
    public validateOpcode(opcode: number): boolean {
        return opcode >= 0 && opcode <= 15; // 4-bit opcode
    }

    /**
     * Resolve effective address based on addressing mode
     * @param mode Addressing mode
     * @param value Operand value
     * @param pc Current program counter
     * @returns Resolved effective address
     */
    public resolveAddress(mode: AddressingMode, value: number, pc: number): number {
        switch (mode) {
            case AddressingMode.Immediate:
                return value;
            case AddressingMode.Direct:
                return value;
            case AddressingMode.Indirect:
                return value; // Actual indirection handled by executor
            case AddressingMode.Indexed:
                return (pc + value) & 0xFFFF; // Wrap to 16 bits
            default:
                throw new Error(`Invalid addressing mode: ${mode}`);
        }
    }
}