/**
 * Core Wars Execution Unit
 * Handles ALU operations, control flow, and status flags
 */

import { AddressingMode, Instruction } from './InstructionDecoder';
import { MemorySystem } from '../memory/MemorySystem';

export enum StatusFlag {
    Zero = 1 << 0,     // Result was zero
    Negative = 1 << 1, // Result was negative
    Overflow = 1 << 2, // Operation caused overflow
    Carry = 1 << 3     // Operation caused carry
}

export enum Opcode {
    MOV = 0x1, // Move data
    ADD = 0x2, // Add
    SUB = 0x3, // Subtract
    MUL = 0x4, // Multiply
    DIV = 0x5, // Divide
    AND = 0x6, // Bitwise AND
    OR  = 0x7, // Bitwise OR
    XOR = 0x8, // Bitwise XOR
    CMP = 0x9, // Compare
    JMP = 0xA, // Jump
    JZ  = 0xB, // Jump if zero
    JNZ = 0xC, // Jump if not zero
    JGT = 0xD, // Jump if greater than
    JLT = 0xE, // Jump if less than
    HLT = 0xF  // Halt execution
}

export class ExecutionUnit {
    private memory: MemorySystem;
    private registers: Uint16Array;
    private flags: number;
    private pc: number;
    private running: boolean;

    // Register indices
    private static readonly R0 = 0;
    private static readonly R1 = 1;
    private static readonly R2 = 2;
    private static readonly R3 = 3;
    private static readonly NUM_REGISTERS = 4;

    constructor(memory: MemorySystem) {
        this.memory = memory;
        this.registers = new Uint16Array(ExecutionUnit.NUM_REGISTERS);
        this.flags = 0;
        this.pc = 0;
        this.running = false;
    }

    /**
     * Execute a single instruction
     * @param instruction Decoded instruction to execute
     * @returns true if execution should continue
     */
    public execute(instruction: Instruction): boolean {
        if (!this.running) {
            return false;
        }

        // Pre-resolve operand A for all instructions
        const operandA = this.resolveOperand(instruction.addressingModeA, instruction.operandA, false);
        let destAddr: number;

        // Only resolve destination for instructions that need it
        switch (instruction.opcode) {
            case Opcode.JMP:
            case Opcode.JZ:
            case Opcode.JNZ:
            case Opcode.JGT:
            case Opcode.JLT:
            case Opcode.HLT:
                // Control flow instructions don't need destination resolution
                destAddr = 0;
                break;
            default:
                // ALU and memory instructions need destination resolution
                destAddr = this.resolveOperand(instruction.addressingModeB, instruction.operandB, true);
        }

        // Execute the instruction
        switch (instruction.opcode) {
            case Opcode.MOV:
                this.mov(operandA, destAddr);
                break;
            case Opcode.ADD:
                this.add(operandA, destAddr);
                break;
            case Opcode.SUB:
                this.sub(operandA, destAddr);
                break;
            case Opcode.MUL:
                this.mul(operandA, destAddr);
                break;
            case Opcode.DIV:
                this.div(operandA, destAddr);
                break;
            case Opcode.AND:
                this.and(operandA, destAddr);
                break;
            case Opcode.OR:
                this.or(operandA, destAddr);
                break;
            case Opcode.XOR:
                this.xor(operandA, destAddr);
                break;
            case Opcode.CMP:
                this.cmp(operandA, this.memory.read(destAddr));
                break;
            case Opcode.JMP:
                this.jmp(instruction.operandA);
                break;
            case Opcode.JZ:
                if (this.hasFlag(StatusFlag.Zero)) this.jmp(instruction.operandA);
                break;
            case Opcode.JNZ:
                if (!this.hasFlag(StatusFlag.Zero)) this.jmp(instruction.operandA);
                break;
            case Opcode.JGT:
                if (!this.hasFlag(StatusFlag.Zero) && !this.hasFlag(StatusFlag.Negative)) this.jmp(instruction.operandA);
                break;
            case Opcode.JLT:
                if (this.hasFlag(StatusFlag.Negative)) this.jmp(instruction.operandA);
                break;
            case Opcode.HLT:
                this.running = false;
                break;
            default:
                throw new Error(`Invalid opcode: ${instruction.opcode}`);
        }

        return this.running;
    }

    /**
     * Start execution
     * @param startAddress Initial program counter value
     */
    public start(startAddress: number): void {
        this.pc = startAddress;
        this.running = true;
    }

    /**
     * Stop execution
     */
    public stop(): void {
        this.running = false;
    }

    /**
     * Get current program counter value
     */
    public getPC(): number {
        return this.pc;
    }

    /**
     * Get current status flags
     */
    public getFlags(): number {
        return this.flags;
    }

    /**
     * Get register value
     * @param index Register index
     */
    public getRegister(index: number): number {
        if (index < 0 || index >= ExecutionUnit.NUM_REGISTERS) {
            throw new Error(`Invalid register index: ${index}`);
        }
        return this.registers[index];
    }

    private resolveOperand(mode: AddressingMode, value: number, isDestination: boolean = false): number {
        let address: number;

        switch (mode) {
            case AddressingMode.Immediate:
                if (isDestination) {
                    throw new Error('Cannot use immediate mode for destination');
                }
                return value & 0xFF;
            case AddressingMode.Direct:
                address = value & 0xFFFF;
                break;
            case AddressingMode.Indirect:
                address = this.memory.read(value & 0xFFFF) & 0xFFFF;
                break;
            case AddressingMode.Indexed:
                address = (this.pc + value) & 0xFFFF;
                break;
            default:
                throw new Error(`Invalid addressing mode: ${mode}`);
        }

        return isDestination ? address : this.memory.read(address);
    }

    private setFlags(result: number, checkOverflow: boolean = false): void {
        this.flags = 0;

        // Zero flag
        if ((result & 0xFF) === 0) {
            this.flags |= StatusFlag.Zero;
        }

        // Negative flag (if high bit is set)
        if ((result & 0x80) !== 0) {
            this.flags |= StatusFlag.Negative;
        }

        // Carry flag
        if (result > 0xFF) {
            this.flags |= StatusFlag.Carry;
        }

        // Overflow flag (for signed arithmetic)
        if (checkOverflow && ((result > 127) || (result < -128))) {
            this.flags |= StatusFlag.Overflow;
        }
    }

    private hasFlag(flag: StatusFlag): boolean {
        return (this.flags & flag) !== 0;
    }

    // Instruction implementations
    private mov(src: number, dest: number): void {
        const value = src & 0xFF;
        this.memory.write(dest, value);
        this.setFlags(value);
    }

    private add(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = (currentValue + (a & 0xFF)) & 0xFFFF;
        this.memory.write(b, result & 0xFF);
        this.setFlags(result, true);
    }

    private sub(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = (currentValue - (a & 0xFF)) & 0xFFFF;
        this.memory.write(b, result & 0xFF);
        this.setFlags(result, true);
    }

    private mul(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = (currentValue * (a & 0xFF)) & 0xFFFF;
        this.memory.write(b, result & 0xFF);
        this.setFlags(result);
    }

    private div(a: number, b: number): void {
        if (a === 0) {
            throw new Error('Division by zero');
        }
        const currentValue = this.memory.read(b);
        const result = Math.floor(currentValue / (a & 0xFF)) & 0xFFFF;
        this.memory.write(b, result & 0xFF);
        this.setFlags(result);
    }

    private and(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = currentValue & (a & 0xFF);
        this.memory.write(b, result);
        this.setFlags(result);
    }

    private or(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = currentValue | (a & 0xFF);
        this.memory.write(b, result);
        this.setFlags(result);
    }

    private xor(a: number, b: number): void {
        const currentValue = this.memory.read(b);
        const result = currentValue ^ (a & 0xFF);
        this.memory.write(b, result);
        this.setFlags(result);
    }

    private cmp(a: number, b: number): void {
        const result = b - a;
        this.setFlags(result);
    }

    private jmp(address: number): void {
        this.pc = address & 0xFFFF;
    }
}