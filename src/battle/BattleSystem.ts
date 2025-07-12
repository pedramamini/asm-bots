/**
 * Core Wars Battle System
 * Integrates memory, instruction execution, and process management
 */

import { ProcessManager } from './ProcessManager.js';
import { BattleController, BattleOptions } from './BattleController.js';
import { ProcessState, ProcessId, ProcessCreateOptions } from './types.js';
import { ExecutionUnit, Opcode } from '../cpu/ExecutionUnit.js';
import { InstructionDecoder, AddressingMode } from '../cpu/InstructionDecoder.js';
import { TrackedMemorySystem } from '../memory/TrackedMemorySystem.js';
import { AssemblyParser } from '../parser/AssemblyParser.js';
import { CodeGenerator } from '../parser/CodeGenerator.js';
import fs from 'fs';
import path from 'path';

interface BotLoadResult {
  processId: ProcessId;
  name: string;
  owner: string;
  entryPoint: number;
  memoryUsed: number;
}

export class BattleSystem {
  private memorySystem: TrackedMemorySystem;
  private processManager: ProcessManager;
  private battleController: BattleController;
  private instructionDecoder: InstructionDecoder;
  private execUnit: ExecutionUnit;
  private parser: AssemblyParser;
  private codeGenerator: CodeGenerator;
  private options: BattleOptions;
  
  constructor(options: BattleOptions) {
    // Initialize memory system with custom size if provided
    const memorySize = options.memorySize || 65536; // Default to 64KB if not specified
    this.memorySystem = new TrackedMemorySystem(memorySize);
    
    // Process manager configuration
    this.processManager = new ProcessManager({
      defaultQuantum: 100,
      defaultPriority: 1,
      maxProcesses: 32, // Allow up to 32 processes in battle for more complicated strategies
      roundRobin: options.roundRobin ?? true // Enable round-robin scheduling by default
    });
    
    this.battleController = new BattleController(this.processManager, options);
    this.instructionDecoder = new InstructionDecoder();
    this.execUnit = new ExecutionUnit(this.memorySystem);
    this.parser = new AssemblyParser();
    this.codeGenerator = new CodeGenerator();
    this.options = options;
    
    console.log(`Initialized battle system with ${memorySize} bytes of memory`);
  }
  
  /**
   * Load a bot from an assembly file
   * @param filePath Path to the bot assembly file
   * @param owner Bot owner name
   * @returns Bot loading result with process ID
   */
  public loadBot(filePath: string, owner: string): BotLoadResult {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    const botName = path.basename(filePath, '.asm');
    
    // Parse assembly code
    const parseResult = this.parser.parse(sourceCode);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors in ${botName}: ${parseResult.errors.map((e: { line: number; message: string }) => `Line ${e.line}: ${e.message}`).join(', ')}`);
    }
    
    // Generate code
    const tokens = parseResult.tokens;
    const symbols = parseResult.symbols;
    const instructions = this.codeGenerator.encode(tokens, symbols);
    const generatedCode = this.codeGenerator.layout(instructions, symbols);
    
    // Get the memory system size to distribute bots more evenly
    const memorySize = this.memorySystem["SIZE"] || 65536;
    
    // Allocate memory for bot with better distribution
    // Use a more sophisticated positioning algorithm to place bots with spacing
    const memoryBase = Math.floor(Math.random() * (memorySize * 0.8)); // Use 80% of memory for better spacing
    this.codeGenerator.relocate(memoryBase);
    
    // Fix the entry point - make sure it points to the start of the first segment
    if (generatedCode.segments.length > 0) {
      generatedCode.entryPoint = generatedCode.segments[0].start;
    }
    
    // Debug output - log the generated code segments
    console.log(`Bot ${botName} generated code:`);
    for (const segment of generatedCode.segments) {
      console.log(`  Segment: ${segment.name}, Start: 0x${segment.start.toString(16)}, Size: ${segment.size}`);
      console.log(`  Data (hex): ${Array.from(segment.data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    console.log(`  Entry point: 0x${generatedCode.entryPoint.toString(16).toUpperCase()}`);
    
    // Create all processes with same priority and small quantum to test round-robin
    const processOptions: ProcessCreateOptions = {
      name: botName,
      owner: owner,
      priority: 1,  // Same priority for all bots
      quantum: 5,   // Very small quantum to force frequent process switching
      memorySegments: generatedCode.segments,
      entryPoint: generatedCode.entryPoint
    };
    
    const processId = this.processManager.create(processOptions);
    
    // Load the process code into the shared memory system
    // Set ownership for initial code load
    this.memorySystem.setCurrentProcess(processId);
    for (const segment of generatedCode.segments) {
      for (let i = 0; i < segment.data.length; i++) {
        const address = segment.start + i;
        this.memorySystem.write(address, segment.data[i]);
      }
      console.log(`Loaded ${segment.name} segment at 0x${segment.start.toString(16)} (${segment.size} bytes)`);
    }
    // Clear current process after loading
    this.memorySystem.setCurrentProcess(null);
    
    // Add to battle
    this.battleController.addProcess(processId);
    
    // Return bot info
    const process = this.processManager.getProcess(processId);
    return {
      processId,
      name: botName,
      owner,
      entryPoint: generatedCode.entryPoint,
      memoryUsed: process.memoryUsed
    };
  }
  
  /**
   * Execute one CPU instruction for the current running process
   * @returns True if execution completed successfully, false if halted
   */
  private executeInstruction(): boolean {
    const currentProcessId = this.processManager.getRunningProcess();
    if (currentProcessId === null) return false;
    
    const process = this.processManager.getProcess(currentProcessId);
    if (process.context.state !== ProcessState.Running) return false;
    
    // Set current process for ownership tracking
    this.memorySystem.setCurrentProcess(currentProcessId);
    
    // Get current PC value
    const pc = process.context.registers.pc;
    
    try {
      // Read instruction from shared memory
      let instruction: { opcode: number; operandBytes: number[] } = { opcode: 0x00, operandBytes: [] }; // Default to NOP if not found
      let instructionStr = "nop"; // Default to NOP instruction name
      let instructionSize = 1;
      
      // Read the opcode from shared memory
      const opcodeByte = this.memorySystem.read(pc);
      instruction.opcode = opcodeByte;
      // Decode operands based on opcode format (simplified)
      const isJumpInstruction = (opcodeByte >= 0x30 && opcodeByte <= 0x38);
      const isCallInstruction = (opcodeByte === 0x42);
      const isSplInstruction = (opcodeByte === 0xA0);
      const isAluInstruction = (opcodeByte >= 0x20 && opcodeByte <= 0x2F);
      const isMovInstruction = (opcodeByte >= 0x10 && opcodeByte <= 0x1F);
      
      // Most instructions are 3 bytes: opcode, operand1, operand2
      if (isMovInstruction || isAluInstruction) {
        instructionSize = 3;
        instruction.operandBytes = [
          this.memorySystem.read(pc + 1),
          this.memorySystem.read(pc + 2)
        ];
      } 
      // Jump, Call, and SPL instructions are 3 bytes: opcode, low byte, high byte
      else if (isJumpInstruction || isCallInstruction || isSplInstruction) {
        instructionSize = 3;
        // Read 16-bit address (little-endian)
        const lowByte = this.memorySystem.read(pc + 1);
        const highByte = this.memorySystem.read(pc + 2);
        const address = lowByte | (highByte << 8);
        instruction.operandBytes = [address];
      }
            
            
            // Map opcodes to instruction names for logging
            switch (opcodeByte) {
              // Basic instructions
              case 0x00: instructionStr = "nop"; break;
              case 0xFF: instructionStr = "halt"; break;
              case 0x10: instructionStr = "mov"; break;
              case 0x11: instructionStr = "xchg"; break;
              
              // Arithmetic
              case 0x20: instructionStr = "add"; break;
              case 0x21: instructionStr = "sub"; break;
              case 0x22: instructionStr = "mul"; break;
              case 0x23: instructionStr = "div"; break;
              
              // Jumps
              case 0x30: instructionStr = "jmp"; break;
              case 0x31: instructionStr = "jz"; break;
              case 0x32: instructionStr = "jnz"; break;
              case 0x33: instructionStr = "je"; break;
              case 0x34: instructionStr = "jne"; break;
              case 0x35: instructionStr = "jl"; break;
              case 0x36: instructionStr = "jg"; break;
              case 0x37: instructionStr = "jge"; break;
              case 0x38: instructionStr = "jle"; break;
              
              // Stack operations
              case 0x40: instructionStr = "push"; break;
              case 0x41: instructionStr = "pop"; break;
              case 0x42: instructionStr = "call"; break;
              case 0x43: instructionStr = "ret"; break;
              
              // Logical operations
              case 0x50: instructionStr = "and"; break;
              case 0x51: instructionStr = "or"; break;
              case 0x52: instructionStr = "xor"; break;
              case 0x53: instructionStr = "not"; break;
              
              // Simple operations
              case 0x60: instructionStr = "inc"; break;
              case 0x61: instructionStr = "dec"; break;
              
              // Comparison
              case 0x70: instructionStr = "cmp"; break;
              case 0x71: instructionStr = "test"; break;
              
              // Memory operations
              case 0x80: instructionStr = "lea"; break;
              case 0x90: instructionStr = "load"; break;
              case 0x91: instructionStr = "store"; break;
              
              // Special operations
              case 0xA0: instructionStr = "spl"; break; // Split instruction
              case 0xF0: instructionStr = "dat"; break; // Data/bomb
              
              default:
                // For simulation purposes, make unknown opcodes work as nops
                instructionStr = `unknown(0x${opcodeByte.toString(16)})`;
                instruction.opcode = 0x00; // Treat as NOP
                break;
            }
      
      // Store instruction for logging
      process.context.currentInstruction = instructionStr;
      
      // Execute the instruction based on opcode
      const shouldAdvancePC = this.executeOpcodeForProcess(currentProcessId, instruction.opcode, instruction.operandBytes);
      
      // Only advance PC if the opcode execution didn't modify it (like JMP)
      if (shouldAdvancePC && process.context.registers.pc === pc) {
        // Keep the high bits of the PC when advancing
        const highBytes = pc & 0xFFFF0000;
        process.context.registers.pc = highBytes | ((pc + instructionSize) & 0xFFFF);
      }
      
      // Log which instruction is being executed
      console.log(`Process ${currentProcessId} executing: ${instructionStr} at PC=0x${pc.toString(16)}`);
      if (instruction.operandBytes.length > 0) {
        console.log(`  Operands: ${instruction.operandBytes.map(b => '0x' + b.toString(16)).join(', ')}`);
      }
      
      // If this is a halt instruction OR we hit too many unknown opcodes, terminate the process
      // This helps make battles more interesting by having processes run longer
      if (instruction.opcode === 0xFF) {
        this.processManager.terminate(currentProcessId, "Halt instruction executed");
        this.memorySystem.setCurrentProcess(null);
        return false;
      }
      
      // Keep the battle going for demonstration purposes by having unknown opcodes
      // just advance PC rather than failing the whole process
      
      // Clear current process after execution
      this.memorySystem.setCurrentProcess(null);
      return true;
    } catch (error) {
      // Handle execution errors
      console.error(`Execution error for process ${currentProcessId}: ${error}`);
      this.processManager.terminate(currentProcessId, `Execution error: ${error}`);
      
      // Clear current process on error too
      this.memorySystem.setCurrentProcess(null);
      return false;
    }
  }
  
  /**
   * Execute an opcode for a specific process
   * @param processId Process ID
   * @param opcode Instruction opcode
   * @param operands Instruction operands
   * @returns True if PC should be advanced normally, false if the instruction modified PC
   */
  private executeOpcodeForProcess(processId: ProcessId, opcode: number, operands: number[]): boolean {
    // This is the heart of the bot execution logic
    // Each opcode is interpreted and executed for the current process
    // To see more interesting battles, use this method to modify how opcodes work
    // and add new functionality
    const process = this.processManager.getProcess(processId);
    const registers = process.context.registers;
    
    // Helper to get register by index
    const getRegisterByIndex = (idx: number): number => {
      idx = idx & 0x3; // Ensure valid index (0-3)
      switch (idx) {
        case 0: return registers.r0;
        case 1: return registers.r1;
        case 2: return registers.r2;
        case 3: return registers.r3;
        default: return 0;
      }
    };
    
    // Helper to set register by index
    const setRegisterByIndex = (idx: number, value: number): void => {
      idx = idx & 0x3; // Ensure valid index (0-3)
      const maskedValue = value & 0xFFFF; // 16-bit value
      switch (idx) {
        case 0: registers.r0 = maskedValue; break;
        case 1: registers.r1 = maskedValue; break;
        case 2: registers.r2 = maskedValue; break;
        case 3: registers.r3 = maskedValue; break;
      }
    };
    
    // Helper to handle memory read with bounds checking
    const safeMemoryRead = (address: number): number => {
      try {
        return this.memorySystem.read(address & 0xFFFF);
      } catch (error) {
        console.warn(`Memory read error at ${address.toString(16)}: ${error}`);
        return 0;
      }
    };
    
    // Helper to handle memory write with bounds checking
    const safeMemoryWrite = (address: number, value: number): void => {
      try {
        this.memorySystem.write(address & 0xFFFF, value & 0xFFFF);
      } catch (error) {
        console.warn(`Memory write error at ${address.toString(16)}: ${error}`);
      }
    };
    
    // Execute instruction based on opcode
    switch (opcode) {
      // Basic operations
      case 0x00: // NOP
        // No operation, just advance PC
        break;
        
      case 0x10: // MOV - Move data
        if (operands.length >= 2) {
          const src = operands[0];
          const dest = operands[1];
          
          if (src < 4) { // Register source
            setRegisterByIndex(dest, getRegisterByIndex(src));
          } else if (dest < 4) { // Memory to register
            const memValue = safeMemoryRead(src);
            setRegisterByIndex(dest, memValue);
          } else { // Memory to memory or immediate to memory
            const value = src < 4 ? getRegisterByIndex(src) : src;
            safeMemoryWrite(dest, value);
          }
        }
        break;
        
      case 0x11: // XCHG - Exchange values
        if (operands.length >= 2) {
          const a = operands[0] & 0x3;
          const b = operands[1] & 0x3;
          const temp = getRegisterByIndex(a);
          setRegisterByIndex(a, getRegisterByIndex(b));
          setRegisterByIndex(b, temp);
        }
        break;
        
      // Arithmetic operations
      case 0x20: // ADD
        if (operands.length >= 2) {
          const a = operands[0];
          const b = operands[1];
          
          if (a < 4 && b < 4) { // Register-to-register
            const result = (getRegisterByIndex(b) + getRegisterByIndex(a)) & 0xFFFF;
            setRegisterByIndex(b, result);
          } else if (b < 4) { // Immediate-to-register
            const result = (getRegisterByIndex(b) + a) & 0xFFFF;
            setRegisterByIndex(b, result);
          }
        }
        break;
        
      case 0x21: // SUB
        if (operands.length >= 2) {
          const a = operands[0];
          const b = operands[1];
          
          if (a < 4 && b < 4) { // Register-to-register
            const result = (getRegisterByIndex(b) - getRegisterByIndex(a)) & 0xFFFF;
            setRegisterByIndex(b, result);
          } else if (b < 4) { // Immediate-to-register
            const result = (getRegisterByIndex(b) - a) & 0xFFFF;
            setRegisterByIndex(b, result);
          }
        }
        break;
        
      case 0x22: // MUL
        if (operands.length >= 2) {
          const a = operands[0];
          const b = operands[1];
          
          if (a < 4 && b < 4) { // Register-to-register
            const result = (getRegisterByIndex(b) * getRegisterByIndex(a)) & 0xFFFF;
            setRegisterByIndex(b, result);
          } else if (b < 4) { // Immediate-to-register
            const result = (getRegisterByIndex(b) * a) & 0xFFFF;
            setRegisterByIndex(b, result);
          }
        }
        break;
        
      case 0x23: // DIV
        if (operands.length >= 2) {
          const a = operands[0];
          const b = operands[1];
          const divisor = a < 4 ? getRegisterByIndex(a) : a;
          
          if (divisor === 0) {
            // Division by zero - set result to 0
            if (b < 4) setRegisterByIndex(b, 0);
          } else if (b < 4) {
            const result = Math.floor(getRegisterByIndex(b) / divisor) & 0xFFFF;
            setRegisterByIndex(b, result);
          }
        }
        break;
        
      // Jump/branch instructions
      case 0x30: // JMP - Unconditional jump
        if (operands.length >= 1) {
          const target = operands[0];
          
          // Handle relative jumps (if target value is small, treat as offset)
          if (target < 0x100) {
            // Small value - treat as relative jump within this segment
            // Find which segment PC is in
            for (const segment of process.context.memory) {
              if (process.context.registers.pc >= segment.start && 
                  process.context.registers.pc < segment.start + segment.size) {
                // Use segment start as base and target as offset
                const targetAddress = segment.start + target;
                process.context.registers.pc = targetAddress;
                break;
              }
            }
          } else {
            // Absolute address - preserve high bytes
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
          }
        }
        return false; // Don't advance PC
        
      case 0x31: // JZ - Jump if zero
        if (operands.length >= 1) {
          const target = operands[0];
          if (registers.r0 === 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      case 0x32: // JNZ - Jump if not zero
        if (operands.length >= 1) {
          const target = operands[0];
          if (registers.r0 !== 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      case 0x33: // JE - Jump if equal (alias for JZ)
        if (operands.length >= 1) {
          const target = operands[0];
          if (registers.r0 === 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      case 0x34: // JNE - Jump if not equal (alias for JNZ)
        if (operands.length >= 1) {
          const target = operands[0];
          if (registers.r0 !== 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      case 0x35: // JL - Jump if less than
        if (operands.length >= 1) {
          const target = operands[0];
          // Check if r0 is negative (high bit set)
          if ((registers.r0 & 0x8000) !== 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      case 0x36: // JG - Jump if greater than
        if (operands.length >= 1) {
          const target = operands[0];
          // Check if r0 is positive and non-zero
          if (registers.r0 !== 0 && (registers.r0 & 0x8000) === 0) {
            const highBytes = process.context.registers.pc & 0xFFFF0000;
            const targetAddress = highBytes | (target & 0xFFFF);
            process.context.registers.pc = targetAddress;
            return false; // Don't advance PC if we jumped
          }
        }
        return true; // Advance PC if we didn't jump
        
      // Stack operations  
      case 0x40: // PUSH - Push to stack
        if (operands.length >= 1) {
          const value = operands[0] < 4 ? getRegisterByIndex(operands[0]) : operands[0];
          registers.sp = (registers.sp - 2) & 0xFFFF;
          safeMemoryWrite(registers.sp, value);
        }
        break;
        
      case 0x41: // POP - Pop from stack
        if (operands.length >= 1 && operands[0] < 4) {
          const value = safeMemoryRead(registers.sp);
          setRegisterByIndex(operands[0], value);
          registers.sp = (registers.sp + 2) & 0xFFFF;
        }
        break;
        
      case 0x42: // CALL - Call subroutine
        if (operands.length >= 1) {
          const target = operands[0];
          // Push current PC + 3 (size of CALL instruction) to stack
          registers.sp = (registers.sp - 2) & 0xFFFF;
          safeMemoryWrite(registers.sp, registers.pc + 3);
          // Jump to target (preserve high bits of PC)
          const highBytes = process.context.registers.pc & 0xFFFF0000;
          const targetAddress = highBytes | (target & 0xFFFF);
          process.context.registers.pc = targetAddress;
          return false; // Don't advance PC, we've explicitly set it
        }
        return true;
        
      case 0x43: // RET - Return from subroutine
        // Pop address from stack and jump to it
        const returnAddr = safeMemoryRead(registers.sp);
        registers.sp = (registers.sp + 2) & 0xFFFF;
        // Preserve high bits of PC for the return jump
        const highBytes = process.context.registers.pc & 0xFFFF0000;
        const targetAddress = highBytes | (returnAddr & 0xFFFF);
        process.context.registers.pc = targetAddress;
        return false; // Don't advance PC, we've explicitly set it
        
      // Memory operations  
      case 0x90: // LOAD - Load from memory to register
        if (operands.length >= 2) {
          const address = operands[0];
          const registerIdx = operands[1] & 0x3;
          const value = safeMemoryRead(address);
          setRegisterByIndex(registerIdx, value);
        }
        break;
        
      case 0x91: // STORE - Store from register to memory
        if (operands.length >= 2) {
          const registerIdx = operands[0] & 0x3;
          const address = operands[1];
          const value = getRegisterByIndex(registerIdx);
          safeMemoryWrite(address, value);
        }
        break;
        
      // Simple operations  
      case 0x60: // INC - Increment
        if (operands.length >= 1) {
          const regIdx = operands[0] & 0x3;
          const newValue = (getRegisterByIndex(regIdx) + 1) & 0xFFFF;
          setRegisterByIndex(regIdx, newValue);
        }
        break;
        
      case 0x61: // DEC - Decrement
        if (operands.length >= 1) {
          const regIdx = operands[0] & 0x3;
          const newValue = (getRegisterByIndex(regIdx) - 1) & 0xFFFF;
          setRegisterByIndex(regIdx, newValue);
        }
        break;
        
      // Comparison  
      case 0x70: // CMP - Compare
        if (operands.length >= 2) {
          const a = operands[0];
          const b = operands[1];
          
          // Simple comparison - set R0 to difference
          if (a < 4 && b < 4) { // Register-to-register
            const result = (getRegisterByIndex(b) - getRegisterByIndex(a)) & 0xFFFF;
            registers.r0 = result;
          } else if (b < 4) { // Immediate-to-register
            const result = (getRegisterByIndex(b) - a) & 0xFFFF;
            registers.r0 = result;
          }
        }
        break;
        
      // Logical operations
      case 0x50: // AND - Logical AND
        if (operands.length >= 2 && operands[1] < 4) {
          const a = operands[0] < 4 ? getRegisterByIndex(operands[0]) : operands[0];
          const result = getRegisterByIndex(operands[1]) & a;
          setRegisterByIndex(operands[1], result);
        }
        break;
        
      case 0x51: // OR - Logical OR
        if (operands.length >= 2 && operands[1] < 4) {
          const a = operands[0] < 4 ? getRegisterByIndex(operands[0]) : operands[0];
          const result = getRegisterByIndex(operands[1]) | a;
          setRegisterByIndex(operands[1], result);
        }
        break;
        
      case 0x52: // XOR - Logical XOR
        if (operands.length >= 2 && operands[1] < 4) {
          const a = operands[0] < 4 ? getRegisterByIndex(operands[0]) : operands[0];
          const result = getRegisterByIndex(operands[1]) ^ a;
          setRegisterByIndex(operands[1], result);
        }
        break;
        
      case 0x53: // NOT - Logical NOT
        if (operands.length >= 1 && operands[0] < 4) {
          const result = ~getRegisterByIndex(operands[0]) & 0xFFFF;
          setRegisterByIndex(operands[0], result);
        }
        break;
        
      // Special operations  
      case 0xA0: // SPL - Split process
        if (operands.length >= 1) {
          // SPL operand is an absolute address after relocation
          const targetAddr = operands[0];
          
          console.log(`SPL instruction: creating child process at 0x${targetAddr.toString(16)}`);
          
          // Get the current process to copy its context
          const parentProcess = this.processManager.getProcess(processId);
          
          // Check if we've hit the process limit by counting active processes in battle
          if (this.battleController) {
            const battleState = this.battleController.getState();
            const activeCount = battleState.processes.filter(pid => {
              const p = this.processManager.getProcess(pid);
              return p.context.state !== ProcessState.Terminated;
            }).length;
            
            if (activeCount >= 32) {
              console.log(`Process ${processId} failed to split: process limit reached`);
              break;
            }
          }
          
          // Create a new process with the same memory segments and owner
          const childOptions: ProcessCreateOptions = {
            name: `${parentProcess.name}_child${Date.now()}`,
            owner: parentProcess.owner,
            priority: parentProcess.priority,
            quantum: parentProcess.quantum,
            memorySegments: parentProcess.context.memory, // Share memory segments
            entryPoint: targetAddr // New process starts at target address
          };
          
          try {
            const childId = this.processManager.create(childOptions);
            
            // Add the new process to the battle if battleController is available
            if (this.battleController) {
              const battleState = this.battleController.getState();
              if (battleState.status === 'running') {
                this.battleController.addProcess(childId);
              }
            }
            
            console.log(`Process ${processId} split: created child process ${childId} at 0x${targetAddr.toString(16)}`);
            
            // Both parent and child continue execution
            // Parent continues at next instruction (normal PC advance)
            // Child starts at targetAddr
          } catch (error) {
            console.warn(`Failed to split process ${processId}: ${error}`);
          }
        }
        break;
        
      case 0xF0: // DAT - Data bomb
        // DAT is a special instruction that should terminate the process when executed
        this.processManager.terminate(processId, "DAT bomb executed");
        break;
        
      case 0xFF: // HALT - Halt execution
        // Process will be terminated after execution
        break;
        
      default:
        // Default case for unknown opcodes - return true to advance PC
        return true;
    }
    
    // For all other opcodes, return true to advance PC by default
    return true;
  }
  
  /**
   * Format an instruction for logging
   */
  private formatInstruction(instruction: {
    opcode: number;
    addressingModeA: AddressingMode;
    addressingModeB: AddressingMode;
    operandA: number;
    operandB: number;
  }): string {
    const opcodeNames: Record<number, string> = {
      0x1: "MOV", 0x2: "ADD", 0x3: "SUB", 0x4: "MUL", 0x5: "DIV",
      0x6: "AND", 0x7: "OR", 0x8: "XOR", 0x9: "CMP",
      0xA: "JMP", 0xB: "JZ", 0xC: "JNZ", 0xD: "JGT", 0xE: "JLT", 0xF: "HLT"
    };
    
    const addrModeNames: Record<AddressingMode, string> = {
      [AddressingMode.Immediate]: "#",
      [AddressingMode.Direct]: "",
      [AddressingMode.Indirect]: "@",
      [AddressingMode.Indexed]: "+"
    };
    
    const opname = opcodeNames[instruction.opcode] || `UNK(${instruction.opcode})`;
    const op1 = `${addrModeNames[instruction.addressingModeA]}${instruction.operandA.toString(16).padStart(2, '0')}`;
    
    // Some instructions have only one operand
    const isSingleOp = [Opcode.JMP, Opcode.JZ, Opcode.JNZ, Opcode.JGT, Opcode.JLT, Opcode.HLT].includes(instruction.opcode);
    
    return isSingleOp
      ? `${opname} ${op1}`
      : `${opname} ${op1}, ${addrModeNames[instruction.addressingModeB]}${instruction.operandB.toString(16).padStart(2, '0')}`;
  }
  
  /**
   * Run a battle for specified number of turns
   * @param turns Number of turns to run, or run until completion if not specified
   * @returns Battle results
   */
  public runBattle(turns?: number): any {
    // Set up instruction execution handlers
    this.setupExecutionHandlers();
    
    // Start the battle
    this.battleController.start();
    
    // Prevent instant termination of all bots
    // Give each bot a chance to run multiple instructions
    // This makes for more interesting battles
    const MIN_INSTRUCTIONS_PER_BOT = 20;
    const allProcesses = this.battleController.getAllProcessInfo();
    const totalMinInstructions = allProcesses.length * MIN_INSTRUCTIONS_PER_BOT;
    
    // Force minimum number of turns to make battles more interesting
    const MIN_TURNS = 10;
    
    // If turns specified, run that many turns
    if (turns !== undefined) {
      let completedTurns = 0;
      let running = true;
      let totalCycles = 0;
      
      // Run at least MIN_TURNS turns to ensure all bots get a chance to execute
      const minTurns = Math.max(MIN_TURNS, turns);
      
      // Run the battle loop
      while (running && completedTurns < minTurns) {
        running = this.battleController.nextTurn();
        completedTurns++;
        totalCycles += this.options.maxCyclesPerTurn || 100;
        
        // Progress reporting
        if (completedTurns % 5 === 0) {
          console.log(`Completed ${completedTurns} turns, ${totalCycles} cycles executed...`);
          
          // Get process status updates
          const processInfo = this.battleController.getAllProcessInfo();
          console.log("Active processes:", processInfo.filter(p => p.state !== "Terminated").length);
        }
        
        // Check if all processes have terminated but we haven't reached min turns
        const processes = this.battleController.getAllProcessInfo();
        const activeProcesses = processes.filter(p => p.state !== 'Terminated');
        
        // If we've reached our minimum turns, let natural termination happen
        if (completedTurns >= MIN_TURNS && activeProcesses.length <= 1) {
          console.log(`Only ${activeProcesses.length} active processes remaining after ${completedTurns} turns - ending battle`);
          break;
        }
      }
    } else {
      // Run until battle completes
      let turnCount = 0;
      let totalCycles = 0;
      
      // Run the main battle loop
      while (this.battleController.nextTurn()) {
        turnCount++;
        totalCycles += this.options.maxCyclesPerTurn || 100;
        
        // Add logging for longer battles
        if (turnCount % 10 === 0) {
          console.log(`Running turn ${turnCount}, ${totalCycles} cycles executed...`);
          
          // Get process status updates
          const processInfo = this.battleController.getAllProcessInfo();
          console.log("Active processes:", processInfo.filter(p => p.state !== "Terminated").length);
        }
        
        // Progress check - ensure we're still making progress
        if (turnCount % 25 === 0) {
          const processes = this.battleController.getAllProcessInfo();
          const activeProcesses = processes.filter(p => p.state !== 'Terminated');
          
          // If we're down to 0-1 active processes after minimum turns, end
          if (turnCount >= MIN_TURNS && activeProcesses.length <= 1) {
            console.log(`Only ${activeProcesses.length} active processes remaining - ending battle`);
            break;
          }
        }
        
        // Prevent infinite loops by setting a maximum number of turns
        const MAX_TURNS = 100;
        if (turnCount >= MAX_TURNS) {
          console.log(`Reached maximum turn limit (${turnCount})`);
          break;
        }
      }
    }
    
    // Get and return battle results
    const results = this.battleController.getBattleResults();
    
    // Log the winner
    if (results.winner !== null) {
      const controller = this.battleController;
      const winnerProcess = controller.getProcessInfo(results.winner);
      console.log(`Battle winner: ${winnerProcess.name} (Process ${results.winner})`);
      
      // Show the winner's stats
      const winnerScore = results.scores.get(results.winner) || 0;
      console.log(`Winner executed ${winnerScore} instructions and survived ${winnerProcess.cycles} cycles`);
    } else {
      console.log('Battle ended with no winner');
    }
    
    return results;
  }
  
  /**
   * Set up handlers for execution events from BattleController
   */
  private setupExecutionHandlers(): void {
    // Before each instruction execution
    this.battleController.onBeforeExecution = (processId: ProcessId) => {
      // Execute the instruction for this process
      const executed = this.executeInstruction();
      if (!executed) {
        console.log(`Failed to execute instruction for process ${processId}`);
      }
    };
    
    // After each instruction execution
    this.battleController.onAfterExecution = (processId: ProcessId) => {
      // Handle any post-execution logic
      const process = this.processManager.getProcess(processId);
      
      // Check for memory access violations that might have occurred during execution
      const accessViolations = this.memorySystem.getAccessLog();
      if (accessViolations.length > 0) {
        console.warn(`Process ${processId} (${process.name}) caused memory violations:`, 
          accessViolations.map(v => v.message).join(', '));
          
        // Clear the log for next execution
        this.memorySystem.clearAccessLog();
      }
    };
  }
  
  /**
   * Get access to the battle controller for status updates
   */
  public getBattleController(): BattleController {
    return this.battleController;
  }
  
  /**
   * Get access to the memory system for visualization
   */
  public getMemorySystem(): TrackedMemorySystem {
    return this.memorySystem;
  }

  /**
   * Get access to the process manager
   */
  public getProcessManager(): ProcessManager {
    return this.processManager;
  }
  
  /**
   * Reset the battle system for a new battle
   */
  public reset(): void {
    // Reset all components
    this.battleController.reset();
    this.memorySystem = new TrackedMemorySystem(); // Create fresh memory system
    this.execUnit = new ExecutionUnit(this.memorySystem); // Create new execution unit
  }
}