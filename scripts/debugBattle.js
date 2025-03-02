/**
 * ASM-Bots Battle Debug Script
 * Identifies issues with bot execution and parsing
 */

import { BattleSystem } from '../dist/battle/BattleSystem.js';
import { ProcessManager } from '../dist/battle/ProcessManager.js';
import path from 'path';
import fs from 'fs';

// Define debug options with verbose output
const options = {
  maxTurns: 150,                // More turns for longer battles
  maxCyclesPerTurn: 10000,      // More cycles per turn for complex processing
  maxMemoryPerProcess: 1048576, // 1MB per process
  maxLogEntries: 10000,         // More log entries to debug
  memorySize: 4194304,          // 4MB total memory size
  coreDump: true,               // Enable core dumps
  cycleLimit: 100000,           // Higher limit on total cycles for a process
  timeLimit: 30000,             // 30 second time limit
  debug: true                   // Enable extra debug output
};

// Initialize components directly for more control
const battleSystem = new BattleSystem(options);
const memorySystem = battleSystem.getMemorySystem();

// Add a simple custom Bot
async function debugBattle() {
  console.log('🔍 ASM-Bots Battle System Debugger 🔍');
  
  // Load a bot
  const botPath = path.join(process.cwd(), 'bots', 'simple_test.asm');
  const bot = battleSystem.loadBot(botPath, 'Debug');
  
  console.log(`\\n=== Bot Details ===`);
  console.log(`Bot loaded: ${bot.name}`);
  console.log(`Entry point: 0x${bot.entryPoint.toString(16).toUpperCase()}`);
  console.log(`Memory used: ${bot.memoryUsed} bytes`);
  
  // Debug memory contents at entry point
  console.log(`\\n=== Memory Contents ===`);
  // Access memory system through battle system
  const memory = memorySystem.getMemorySystem();
  
  // Dump memory around entry point
  const startAddr = Math.max(0, bot.entryPoint - 16);
  const endAddr = Math.min(4194304, bot.entryPoint + 32); // Use the same size defined in options
  
  console.log(`Memory dump from 0x${startAddr.toString(16).toUpperCase()} to 0x${endAddr.toString(16).toUpperCase()}:`);
  let line = '';
  for (let addr = startAddr; addr < endAddr; addr++) {
    if ((addr - startAddr) % 16 === 0) {
      if (line) console.log(line);
      line = `0x${addr.toString(16).padStart(8, '0')}: `;
    }
    
    try {
      const value = memory.read(addr);
      line += value.toString(16).padStart(2, '0') + ' ';
      
      // Highlight entry point
      if (addr === bot.entryPoint) {
        line += '← ENTRY ';
      }
    } catch (e) {
      line += 'XX ';
    }
  }
  if (line) console.log(line);
  
  // Run battle with extra debug
  console.log(`\\n=== Starting Debug Battle ===`);
  
  // Monkey patch the execution function to add more debug info
  const originalExecuteInstruction = battleSystem['executeInstruction'];
  battleSystem['executeInstruction'] = function() {
    const currentProcessId = this.processManager.getRunningProcess();
    if (!currentProcessId) return false;
    
    const process = this.processManager.getProcess(currentProcessId);
    const pc = process.context.registers.pc;
    
    // Debug instruction location
    console.log(`\n[DEBUG] Process ${currentProcessId} execution at PC=0x${pc.toString(16).toUpperCase()}`);
    console.log(`[DEBUG] R0=${process.context.registers.r0}, R1=${process.context.registers.r1}`);
    
    // Dump memory around PC
    console.log(`[DEBUG] Memory near PC:`);
    let memDump = '';
    for (let addr = pc - 2; addr <= pc + 5; addr++) {
      if (addr < 0) continue;
      try {
        const value = this.memorySystem.read(addr);
        memDump += value.toString(16).padStart(2, '0') + ' ';
        if (addr === pc) memDump += '← PC ';
      } catch (e) {
        memDump += 'XX ';
      }
    }
    console.log(memDump);
    
    // Call original function
    const result = originalExecuteInstruction.apply(this, arguments);
    
    // After execution
    console.log(`[DEBUG] After execution: PC=0x${process.context.registers.pc.toString(16).toUpperCase()}`);
    console.log(`[DEBUG] R0=${process.context.registers.r0}, R1=${process.context.registers.r1}`);
    
    return result;
  };
  
  // Run the battle
  const results = battleSystem.runBattle(5); // Run for 5 turns max
  
  console.log(`\\n=== Debug Battle Results ===`);
  console.log(`Duration: ${results.duration / 1000} seconds`);
  console.log(`Turns completed: ${results.turns}`);
  
  if (results.winner !== null) {
    const controller = battleSystem.getBattleController();
    const winnerProcess = controller.getProcessInfo(results.winner);
    console.log(`Winner: ${winnerProcess.name} (Process ${results.winner})`);
  } else {
    console.log('No winner determined');
  }
}

// Run the debug
debugBattle();