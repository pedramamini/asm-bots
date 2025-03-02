/**
 * ASM-Bots Battle Runner Script
 * Runs a battle between the most advanced bots
 */

import { BattleRunner } from './battle/BattleRunner.js';
import path from 'path';
import fs from 'fs';

// Define advanced bots to battle
const ADVANCED_BOTS = [
  'hunter.asm',
  'scanner.asm',
  'fortress.asm',
  'vampire.asm'
];

// Battle options
const options = {
  maxTurns: 2000,
  maxCyclesPerTurn: 100000,
  maxMemoryPerProcess: 8192,
  maxLogEntries: 10000
};

async function runAdvancedBattles() {
  console.log('🤖 ASM-Bots Battle System 🤖');
  console.log('Running battle between advanced bots...');
  
  const botsDir = path.join(process.cwd(), 'bots');
  const runner = new BattleRunner(options);
  
  // Check if bots exist
  for (const botName of ADVANCED_BOTS) {
    const botPath = path.join(botsDir, botName);
    if (!fs.existsSync(botPath)) {
      console.error(`Bot not found: ${botPath}`);
      process.exit(1);
    }
    
    // Add bot to battle
    runner.addBot(botPath, `Player ${ADVANCED_BOTS.indexOf(botName) + 1}`);
    console.log(`Added bot: ${botName}`);
  }
  
  // Set verbose mode for detailed output
  runner.setVerbose(true);
  
  console.log('\n=== Starting Battle ===\n');
  
  try {
    // Run the battle
    const results = await runner.runBattle();
    
    // Display summarized results
    console.log('\n=== Battle Summary ===');
    console.log(`Total turns: ${results.turns}`);
    console.log(`Duration: ${results.duration / 1000} seconds`);
    
    if (results.winner !== null) {
      const winnerProcess = results.processes.find((p: any) => p.id === results.winner);
      if (winnerProcess) {
        console.log(`Winner: ${winnerProcess.name} (${winnerProcess.owner})`);
      } else {
        console.log('Winner ID:', results.winner, '(process details not found)');
      }
    } else {
      console.log('No winner - battle ended in a draw');
    }
    
    // Display final scores
    console.log('\n=== Final Scores ===');
    results.processes.forEach((process: any) => {
      const score = results.scores.get(process.id) || 0;
      console.log(`${process.name}: ${score} points (${process.state})`);
    });
    
  } catch (error) {
    console.error('Battle error:', error);
    process.exit(1);
  }
}

// Run the battles
runAdvancedBattles();