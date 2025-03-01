/**
 * Core Wars Battle System
 * Integrates memory, instruction execution, and process management
 */

import { ProcessManager } from './ProcessManager.js';
import { BattleController, BattleOptions } from './BattleController.js';
import { ProcessState, ProcessId, ProcessCreateOptions } from './types.js';
import { ExecutionUnit, Opcode } from '../cpu/ExecutionUnit.js';
import { InstructionDecoder, AddressingMode } from '../cpu/InstructionDecoder.js';
import { MemorySystem } from '../memory/MemorySystem.js';
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
  private memorySystem: MemorySystem;
  private processManager: ProcessManager;
  private battleController: BattleController;
  private instructionDecoder: InstructionDecoder;
  private execUnit: ExecutionUnit;
  private parser: AssemblyParser;
  private codeGenerator: CodeGenerator;
  
  constructor(options: BattleOptions) {
    this.memorySystem = new MemorySystem();
    this.processManager = new ProcessManager({
      defaultQuantum: 100,
      defaultPriority: 1,
      maxProcesses: 16 // Allow up to 16 processes in battle
    });
    
    this.battleController = new BattleController(this.processManager, options);
    this.instructionDecoder = new InstructionDecoder();
    this.execUnit = new ExecutionUnit(this.memorySystem);
    this.parser = new AssemblyParser();
    this.codeGenerator = new CodeGenerator();
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
    const instructions = this.codeGenerator.encode(tokens);
    const generatedCode = this.codeGenerator.layout(instructions, symbols);
    
    // Allocate memory for bot
    const memoryBase = Math.floor(Math.random() * 0xE000); // Random location in memory
    this.codeGenerator.relocate(memoryBase);
    
    // Create process
    const processOptions: ProcessCreateOptions = {
      name: botName,
      owner: owner,
      priority: 1,
      memorySegments: generatedCode.segments,
      entryPoint: generatedCode.entryPoint
    };
    
    const processId = this.processManager.create(processOptions);
    
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
    
    // Get current PC value
    const pc = process.context.registers.pc;
    
    try {
      // For simplicity in our prototype, just log the instruction and treat each as executed
      // In a full implementation, this would properly decode and execute the actual instruction
      
      // Get memory segments for this process
      const segments = process.context.memory;
      let instructionStr = "halt"; // Default to halt if not found
      
      // Find the segment that contains the PC
      for (const segment of segments) {
        if (pc >= segment.start && pc < segment.start + segment.size) {
          // PC is within this segment
          const offset = pc - segment.start;
          if (offset < segment.data.length) {
            // For demonstration, use the byte at PC as a simple operation identifier
            // 0x00 = nop, 0xFF = halt, others would map to different operations
            const opcodeByte = segment.data[offset];
            instructionStr = opcodeByte === 0x00 ? "nop" : "halt";
          }
          break;
        }
      }
      
      // Store instruction for logging
      process.context.currentInstruction = instructionStr;
      
      // In a proper implementation, we would decode and execute the instruction here
      
      // Advance PC (simplified - in a real system, PC would advance based on instruction length)
      process.context.registers.pc = (pc + 1) & 0xFFFF;
      
      // If this is a halt instruction, terminate the process
      if (instructionStr === "halt") {
        this.processManager.terminate(currentProcessId, "Halt instruction");
        return false;
      }
      
      return true;
    } catch (error) {
      // Handle execution errors
      console.error(`Execution error for process ${currentProcessId}: ${error}`);
      this.processManager.terminate(currentProcessId, `Execution error: ${error}`);
      return false;
    }
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
    
    // If turns specified, run that many turns
    if (turns !== undefined) {
      let completedTurns = 0;
      let running = true;
      
      while (running && completedTurns < turns) {
        running = this.battleController.nextTurn();
        completedTurns++;
      }
    } else {
      // Run until battle completes
      while (this.battleController.nextTurn()) {
        // Just keep running turns
      }
    }
    
    return this.battleController.getBattleResults();
  }
  
  /**
   * Set up handlers for execution events from BattleController
   */
  private setupExecutionHandlers(): void {
    // Before each instruction execution
    this.battleController.onBeforeExecution = (processId: ProcessId) => {
      // Execute the instruction for this process
      this.executeInstruction();
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
  public getMemorySystem(): MemorySystem {
    return this.memorySystem;
  }
  
  /**
   * Reset the battle system for a new battle
   */
  public reset(): void {
    // Reset all components
    this.battleController.reset();
    this.memorySystem = new MemorySystem(); // Create fresh memory system
    this.execUnit = new ExecutionUnit(this.memorySystem); // Create new execution unit
  }
}