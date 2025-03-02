/**
 * Minimal debug script to understand what's going on
 */

import { BattleSystem } from '../dist/battle/BattleSystem.js';
import path from 'path';

// Define options
const options = {
  maxTurns: 10,
  maxCyclesPerTurn: 1000,
  maxMemoryPerProcess: 1048576,
  memorySize: 4194304
};

const battleSystem = new BattleSystem(options);

// Add monkey patch to battleSystem to avoid defaulting to HALT
const originalExecuteInstruction = battleSystem['executeInstruction'];
battleSystem['executeInstruction'] = function() {
  console.log("Executing instruction at PC:", this.processManager.getProcess(1).context.registers.pc);
  const result = originalExecuteInstruction.apply(this, arguments);
  console.log("After instruction, PC:", this.processManager.getProcess(1).context.registers.pc);
  return result;
};

async function debugBot() {
  console.log('Loading bot...');
  const botPath = path.join(process.cwd(), 'bots', 'simple_test.asm');
  battleSystem.loadBot(botPath, 'Debug');
  
  // Run the battle
  console.log('\nRunning battle...');
  const results = battleSystem.runBattle(5);
  
  console.log(`\nBattle results: ${results.turns} turns`);
}

debugBot();