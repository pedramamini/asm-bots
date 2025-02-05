import { ExecutionUnit, Opcode, StatusFlag } from './ExecutionUnit';
import { AddressingMode, Instruction } from './InstructionDecoder';
import { MemorySystem } from '../memory/MemorySystem';

describe('ExecutionUnit', () => {
    let memory: MemorySystem;
    let executor: ExecutionUnit;

    beforeEach(() => {
        memory = new MemorySystem();
        executor = new ExecutionUnit(memory);
        executor.start(0x1000); // Start at a reasonable address
    });

    describe('ALU Operations', () => {
        test('executor.perform() updates registers correctly', () => {
            // Test MOV instruction
            const movInstr: Instruction = {
                opcode: Opcode.MOV,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x42,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(movInstr)).toBe(true);
            expect(memory.read(0x1000)).toBe(0x42);

            // Test ADD instruction
            const addInstr: Instruction = {
                opcode: Opcode.ADD,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x10,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(addInstr)).toBe(true);
            expect(memory.read(0x1000)).toBe(0x52); // 0x42 + 0x10 = 0x52
        });

        test('executor.perform() handles overflow correctly', () => {
            // Set up initial value
            memory.write(0x1000, 0xFF);

            // Add 1 to cause overflow
            const addInstr: Instruction = {
                opcode: Opcode.ADD,
                addressingModeA: AddressingMode.Immediate,
                operandA: 1,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(addInstr)).toBe(true);
            expect(memory.read(0x1000)).toBe(0x00);
            expect(executor.getFlags() & StatusFlag.Carry).not.toBe(0);
            expect(executor.getFlags() & StatusFlag.Zero).not.toBe(0);
        });

        test('executor.perform() handles division by zero', () => {
            const divInstr: Instruction = {
                opcode: Opcode.DIV,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(() => executor.execute(divInstr)).toThrow('Division by zero');
        });
    });

    describe('Control Flow', () => {
        test('executor.branch() follows correct paths', () => {
            // Set up a value for comparison
            memory.write(0x1000, 0x42);

            // Compare with immediate value
            const cmpInstr: Instruction = {
                opcode: Opcode.CMP,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x42,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(cmpInstr)).toBe(true);
            expect(executor.getFlags() & StatusFlag.Zero).not.toBe(0); // Should be equal

            // Jump if zero to 0x2000
            const jzInstr: Instruction = {
                opcode: Opcode.JZ,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x2000,
                addressingModeB: AddressingMode.Immediate,
                operandB: 0
            };

            expect(executor.execute(jzInstr)).toBe(true);
            expect(executor.getPC()).toBe(0x2000); // Should have jumped
        });

        test('executor.branch() handles conditional jumps', () => {
            // Set up a value for comparison
            memory.write(0x1000, 0x40);

            // Compare with larger value
            const cmpInstr: Instruction = {
                opcode: Opcode.CMP,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x50,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(cmpInstr)).toBe(true);
            expect(executor.getFlags() & StatusFlag.Negative).not.toBe(0); // Should be less than

            // Jump if less than to 0x3000
            const jltInstr: Instruction = {
                opcode: Opcode.JLT,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x3000,
                addressingModeB: AddressingMode.Immediate,
                operandB: 0
            };

            expect(executor.execute(jltInstr)).toBe(true);
            expect(executor.getPC()).toBe(0x3000); // Should have jumped
        });
    });

    describe('Status Flags', () => {
        test('executor.updateFlags() reflects operation results', () => {
            // Test zero flag
            const movZeroInstr: Instruction = {
                opcode: Opcode.MOV,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(movZeroInstr)).toBe(true);
            expect(executor.getFlags() & StatusFlag.Zero).not.toBe(0);

            // Test negative flag
            const movNegInstr: Instruction = {
                opcode: Opcode.MOV,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x80, // Set high bit
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(movNegInstr)).toBe(true);
            expect(executor.getFlags() & StatusFlag.Negative).not.toBe(0);
        });

        test('executor.updateFlags() handles arithmetic flags', () => {
            // Set up initial value
            memory.write(0x1000, 0x7F);

            // Add 1 to cause overflow
            const addInstr: Instruction = {
                opcode: Opcode.ADD,
                addressingModeA: AddressingMode.Immediate,
                operandA: 1,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x1000
            };

            expect(executor.execute(addInstr)).toBe(true);
            expect(executor.getFlags() & StatusFlag.Overflow).not.toBe(0);
        });
    });

    describe('Halt and Reset', () => {
        test('executor handles HLT instruction', () => {
            const hltInstr: Instruction = {
                opcode: Opcode.HLT,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0,
                addressingModeB: AddressingMode.Immediate,
                operandB: 0
            };

            expect(executor.execute(hltInstr)).toBe(false); // Should stop execution
        });

        test('executor can be restarted', () => {
            const hltInstr: Instruction = {
                opcode: Opcode.HLT,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0,
                addressingModeB: AddressingMode.Immediate,
                operandB: 0
            };

            expect(executor.execute(hltInstr)).toBe(false); // Stop

            executor.start(0x2000); // Restart at new address

            const movInstr: Instruction = {
                opcode: Opcode.MOV,
                addressingModeA: AddressingMode.Immediate,
                operandA: 0x42,
                addressingModeB: AddressingMode.Direct,
                operandB: 0x2000
            };

            expect(executor.execute(movInstr)).toBe(true); // Should execute
            expect(memory.read(0x2000)).toBe(0x42);
        });
    });
});