/**
 * ASM-Bots Battle Runner Script
 * Runs a specific battle with vampire_test.asm
 */

import { BattleRunner } from '../dist/battle/BattleRunner.js';
import path from 'path';
import fs from 'fs';

// Battle options
const options = {
  maxTurns: 50,                 // More turns for longer battles
  maxCyclesPerTurn: 200,        // Fewer cycles per turn to see each bot execute
  maxMemoryPerProcess: 1048576, // 1MB per process
  maxLogEntries: 1000,          // Fewer log entries to avoid spamming console
  memorySize: 4194304,          // 4MB total memory size
  coreDump: false,              // Whether to dump core memory on crash
  cycleLimit: 100000,           // Higher limit on total cycles for a process
  timeLimit: 30000              // 30 second time limit
};

async function runVampireTest() {
  console.log('🤖 ASM-Bots Battle System 🤖');
  console.log('Running battle with vampire_test.asm...');
  
  const botsDir = path.join(process.cwd(), 'bots');
  const runner = new BattleRunner(options);
  
  // Add the vampire test bot to the battle
  const botPath = path.join(botsDir, 'vampire_test.asm');
  if (!fs.existsSync(botPath)) {
    console.error(`Bot not found: ${botPath}`);
    process.exit(1);
  }
  
  // Add bot to battle
  runner.addBot(botPath, 'Vampire');
  console.log(`Added bot: vampire_test.asm`);
  
  // For comparison, add our simple infinite loop bot
  const simpleBot = path.join(botsDir, 'infinite_loop.asm');
  if (fs.existsSync(simpleBot)) {
    runner.addBot(simpleBot, 'InfiniteLoop');
    console.log(`Added bot: infinite_loop.asm`);
  }
  
  // Set verbose mode for detailed output
  runner.setVerbose(true);
  
  console.log('\n=== Starting Battle ===\n');
  
  try {
    // Run the battle
    const results = await runner.runBattle();
    
    // Display summarized results
    console.log('\n\n=== Battle Results ===');
    console.log(`Total turns completed: ${results.turns}`);
    console.log(`Duration: ${results.duration / 1000} seconds`);
    
    if (results.winner !== null) {
      const winnerProcess = results.processes.find(p => p.id === results.winner);
      if (winnerProcess) {
        console.log(`\n🏆 WINNER: ${winnerProcess.name} (${winnerProcess.owner}) 🏆`);
        console.log(`Executed ${results.scores.get(winnerProcess.id) || 0} instructions`);
      } else {
        console.log('Winner ID:', results.winner, '(process details not found)');
      }
    } else {
      console.log('No winner - battle ended in a draw');
    }
    
    // Display final scores as a leaderboard
    console.log('\n=== BATTLE LEADERBOARD ===');
    
    // Sort processes by score
    const sortedProcesses = [...results.processes].sort((a, b) => {
      const scoreA = results.scores.get(a.id) || 0;
      const scoreB = results.scores.get(b.id) || 0;
      return scoreB - scoreA; // Descending order
    });
    
    // Display leaderboard
    console.log('Rank | Bot                | Owner     | Score | Status');
    console.log('-----|-------------------|-----------|-------|--------');
    sortedProcesses.forEach((process, index) => {
      const score = results.scores.get(process.id) || 0;
      const rank = index + 1;
      const isWinner = process.id === results.winner;
      const status = process.state;
      
      console.log(
        `${rank.toString().padEnd(4)} | ` +
        `${process.name.padEnd(17)} | ` +
        `${process.owner.padEnd(9)} | ` +
        `${score.toString().padEnd(5)} | ` +
        `${status}${isWinner ? ' 👑' : ''}`
      );
    });
    
  } catch (error) {
    console.error('Battle error:', error);
    process.exit(1);
  }
}

// Run the battles
runVampireTest();