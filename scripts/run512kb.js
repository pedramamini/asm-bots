/**
 * ASM-Bots Battle Runner Script
 * Runs a battle with specific bots on a 512KB memory board
 */

import { BattleRunner } from '../dist/battle/BattleRunner.js';
import path from 'path';
import fs from 'fs';

// Battle options with 512KB memory
const options = {
  maxTurns: 100,                 // More turns for a longer battle
  maxCyclesPerTurn: 1000,        // More cycles per turn for interesting behavior
  maxMemoryPerProcess: 131072,   // 128KB per process
  maxLogEntries: 1000,           // Fewer log entries to avoid spamming console
  memorySize: 524288,            // 512KB total memory size (as requested)
  coreDump: false,               // Whether to dump core memory on crash
  cycleLimit: 100000,            // Higher limit on total cycles for a process
  timeLimit: 30000               // 30 second time limit
};

async function runBattle() {
  console.log('🤖 ASM-Bots Battle System - 512KB Memory 🤖');
  console.log('Running battle with fortress, hunter, infinite_loop, and vampire bots...');
  
  const botsDir = path.join(process.cwd(), 'bots');
  const runner = new BattleRunner(options);
  
  // Add the specific bots
  const botNames = ['fortress.asm', 'hunter.asm', 'infinite_loop.asm', 'vampire.asm'];
  
  for (const botName of botNames) {
    const botPath = path.join(botsDir, botName);
    if (!fs.existsSync(botPath)) {
      console.error(`Bot not found: ${botPath}`);
      process.exit(1);
    }
    
    // Add bot to battle with the bot name as the owner
    runner.addBot(botPath, path.basename(botName, '.asm'));
    console.log(`Added bot: ${botName}`);
  }
  
  // Set verbose mode to false to avoid too much output
  runner.setVerbose(false);
  
  // Store original log function
  const originalLog = console.log;
  
  // Replace with filtered version
  console.log = function(...args) {
    // Only log if it doesn't contain "executing" or "Process"
    if (args.length > 0 && 
        typeof args[0] === 'string' && 
        !args[0].includes('executing') && 
        !args[0].includes('Process')) {
      originalLog.apply(console, args);
    }
  };
  
  console.log('\n=== Starting Battle ===\n');
  
  try {
    // Set up variables to track battle state
    let leadingBot = null;
    let highestScore = 0;
    let activeBots = new Set([1, 2, 3, 4]); // Initially all bots are active
    let botNames = {
      1: 'fortress',
      2: 'hunter',
      3: 'infinite_loop',
      4: 'vampire'
    };
    
    // Create a monitoring function for battle events
    const monitorBattleEvents = (controller, currentTurn) => {
      if (currentTurn % 5 === 0) { // Check every 5 turns
        // Get process info
        const processes = controller.getAllProcessInfo();
        const scores = controller.getScores();
        
        // Check for knockouts
        processes.forEach(proc => {
          if (activeBots.has(proc.id) && proc.state === 'Terminated') {
            originalLog(`🔴 Turn ${currentTurn}: ${proc.name} has been knocked out!`);
            activeBots.delete(proc.id);
          }
        });
        
        // Check for score changes and new leader
        let currentLeader = null;
        let currentHighScore = 0;
        
        scores.forEach((score, processId) => {
          if (score > currentHighScore) {
            currentHighScore = score;
            currentLeader = processId;
          }
        });
        
        // Report if there's a new leader
        if (currentLeader !== leadingBot || currentHighScore > highestScore + 1000) {
          if (leadingBot !== null) {
            originalLog(`🏆 Turn ${currentTurn}: ${botNames[currentLeader]} takes the lead with ${currentHighScore} points!`);
          } else {
            originalLog(`🏆 Turn ${currentTurn}: ${botNames[currentLeader]} starts with ${currentHighScore} points`);
          }
          leadingBot = currentLeader;
          highestScore = currentHighScore;
        }
        
        // Report active bot count
        if (currentTurn % 20 === 0) {
          originalLog(`Turn ${currentTurn}: ${activeBots.size} bots still active, leader: ${botNames[leadingBot]} (${highestScore} points)`);
        }
      }
    };
    
    // Run the battle with monitoring
    const results = await runner.runBattle(monitorBattleEvents);
    
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