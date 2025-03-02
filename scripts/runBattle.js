/**
 * ASM-Bots Battle Runner Script
 * Runs a battle between specific bots or defaults to advanced bots
 */

import { BattleRunner } from '../dist/battle/BattleRunner.js';
import path from 'path';
import fs from 'fs';

// Define advanced bots to battle if no arguments are provided
const DEFAULT_BOTS = [
  'hunter.asm',    // Using efficient scanning patterns
  'scanner.asm',   // Simple scanning bot
  'fortress.asm',  // Defensive strategy
  'vampire.asm'    // Creates copies of itself 
];

// Battle options
const options = {
  maxTurns: 10,                 // Fewer turns to avoid excessive output
  maxCyclesPerTurn: 100,        // Fewer cycles per turn to see each bot execute
  maxMemoryPerProcess: 1048576, // 1MB per process
  maxLogEntries: 1000,          // Fewer log entries to avoid spamming console
  memorySize: 4194304,          // 4MB total memory size
  coreDump: false,              // Whether to dump core memory on crash
  cycleLimit: 100000,           // Higher limit on total cycles for a process
  timeLimit: 30000              // 30 second time limit
};

async function runBattle() {
  console.log('🤖 ASM-Bots Battle System 🤖');
  
  // Process command line arguments to get bot files
  const args = process.argv.slice(2);
  let botPaths = [];
  
  if (args.length >= 2) {
    // Use the bots specified in the command line arguments
    botPaths = args.map(arg => {
      if (arg.includes('/')) {
        // Path was provided
        return arg;
      } else {
        // Just filename was provided, assume it's in the bots directory
        return path.join(process.cwd(), 'bots', arg);
      }
    });
    console.log(`Running battle with specified bots: ${botPaths.map(p => path.basename(p)).join(', ')}`);
  } else {
    // Use default bots
    const botsDir = path.join(process.cwd(), 'bots');
    botPaths = DEFAULT_BOTS.map(botName => path.join(botsDir, botName));
    console.log('Running battle with default advanced bots...');
  }
  
  const runner = new BattleRunner(options);
  
  // Check if bots exist and add them to the battle
  for (let i = 0; i < botPaths.length; i++) {
    const botPath = botPaths[i];
    if (!fs.existsSync(botPath)) {
      console.error(`Bot not found: ${botPath}`);
      process.exit(1);
    }
    
    // Add bot to battle
    runner.addBot(botPath, `Player ${i + 1}`);
    console.log(`Added bot: ${path.basename(botPath)}`);
  }
  
  // Set verbose mode for detailed output
  runner.setVerbose(true);
  
  console.log('\n=== Starting Battle ===\n');
  
  try {
    // Animation for the battle progress
    const battleInterval = setInterval(() => {
      process.stdout.write('.');
    }, 500);
    
    // Run the battle
    const results = await runner.runBattle();
    
    // Stop animation
    clearInterval(battleInterval);
    
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

// Run the battle
runBattle();