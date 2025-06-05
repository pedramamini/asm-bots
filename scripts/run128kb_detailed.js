/**
 * ASM-Bots Battle Runner Script
 * Runs a battle with specific bots on a 512KB memory board
 * With detailed battle play-by-play
 */

import { BattleRunner } from '../dist/battle/BattleRunner.js';
import { BattleSystem } from '../dist/battle/BattleSystem.js';
import path from 'path';
import fs from 'fs';

// Battle options with 128KB memory
const options = {
  maxTurns: 100000,              // Extremely high turn limit to let bots battle naturally
  maxCyclesPerTurn: 100,         // Few cycles per turn to force more round-robin
  maxMemoryPerProcess: 32768,    // 32KB per process
  maxLogEntries: 1000,           // Fewer log entries to avoid spamming console
  memorySize: 131072,            // 128KB total memory size
  coreDump: true,                // Enable core dump to see memory state on crashes
  cycleLimit: 50000,             // Limit cycles to prevent one bot dominating
  timeLimit: 300000,             // 5 minute time limit
  roundRobin: true               // Enable fair scheduling between bots
};

async function runBattle() {
  console.log('🤖 ASM-Bots Battle System - 128KB Memory with Play-by-Play 🤖');
  console.log('Running battle with fortress, hunter, vampire, and simple_hunter bots...');
  
  // Create our own battle system for direct access to monitoring
  const battleSystem = new BattleSystem(options);
  
  // Prepare the bots - trying without infinite_loop which dominates
  const botsDir = path.join(process.cwd(), 'bots');
  const botNames = ['fortress.asm', 'hunter.asm', 'vampire.asm', 'simple_hunter.asm'];
  const botMap = {};
  
  // Load bots directly
  for (let i = 0; i < botNames.length; i++) {
    const botName = botNames[i];
    const botPath = path.join(botsDir, botName);
    if (!fs.existsSync(botPath)) {
      console.error(`Bot not found: ${botPath}`);
      process.exit(1);
    }
    
    try {
      // Load the bot into the battle system
      const botInfo = battleSystem.loadBot(botPath, path.basename(botName, '.asm'));
      botMap[botInfo.processId] = {
        name: botInfo.name,
        owner: botInfo.owner,
        processId: botInfo.processId
      };
      console.log(`Added bot: ${botName} (Process ID: ${botInfo.processId})`);
    } catch (error) {
      console.error(`Error loading bot ${botName}:`, error);
      process.exit(1);
    }
  }
  
  // Store original log function
  const originalLog = console.log;
  
  // Replace with filtered version
  console.log = function(...args) {
    // Only log if it doesn't contain "executing" or "Process" followed by a number
    if (args.length > 0 && 
        typeof args[0] === 'string' && 
        !args[0].match(/Process \d+ executing/) &&
        !args[0].match(/^Bot .* generated code/)) {
      originalLog.apply(console, args);
    }
  };
  
  // Set up battle state tracking
  let leadingBot = null;
  let highestScore = 0;
  let activeBots = new Set(Object.keys(botMap).map(Number));
  let lastTurnScore = new Map();
  let knockouts = new Set();
  let lastStatusUpdate = 0;
  let battleStartTime = Date.now();
  
  // Make cycleHistory available in broader scope
  let cycleHistory = {};
  let runningBot = null;

  // Create a battle monitor function
  const battleMonitor = () => {
    const controller = battleSystem.getBattleController();
    const currentTurn = controller.getState().turn;
    
    // Only monitor on turn changes
    if (currentTurn % 5 === 0) {
      // Get process information
      const processes = controller.getAllProcessInfo();
      const scores = controller.getState().scores;
      
      // Check for knockouts
      processes.forEach(proc => {
        if (activeBots.has(proc.id) && proc.state === 'Terminated' && !knockouts.has(proc.id)) {
          originalLog(`\n🔴 KNOCKOUT: ${proc.name} (${proc.owner}) has been eliminated at turn ${currentTurn}!`);
          activeBots.delete(proc.id);
          knockouts.add(proc.id);
        }
      });
      
      // Find current leader
      let currentLeader = null;
      let currentHighScore = 0;
      
      scores.forEach((score, processId) => {
        // Check for big score increases
        const lastScore = lastTurnScore.get(processId) || 0;
        const increase = score - lastScore;
        
        // Report significant score increases
        if (increase > 1000 && lastScore > 0) {
          originalLog(`\n🔥 ${botMap[processId].name} scores ${increase} points in the last ${currentTurn % 5} turns!`);
        }
        
        // Save current score
        lastTurnScore.set(processId, score);
        
        // Track highest scorer
        if (score > currentHighScore) {
          currentHighScore = score;
          currentLeader = processId;
        }
      });
      
      // Report new leader
      if (currentLeader !== leadingBot) {
        if (leadingBot !== null) {
          originalLog(`\n🏆 LEAD CHANGE: ${botMap[currentLeader].name} takes the lead with ${currentHighScore} points at turn ${currentTurn}!`);
        } else {
          originalLog(`\n🏆 ${botMap[currentLeader].name} starts with ${currentHighScore} points at turn ${currentTurn}`);
        }
        leadingBot = currentLeader;
        highestScore = currentHighScore;
      }
      // Report on major score increases
      else if (currentHighScore > highestScore + 2000) {
        originalLog(`\n📈 ${botMap[currentLeader].name} extends lead to ${currentHighScore} points at turn ${currentTurn}!`);
        highestScore = currentHighScore;
      }
      
      // Status updates every 20 turns or every 10 seconds
      const now = Date.now();
      if (currentTurn % 20 === 0 || now - lastStatusUpdate > 10000) {
        originalLog(`\n📊 Turn ${currentTurn}: ${activeBots.size} bots still active, leader: ${botMap[leadingBot]?.name || 'none'} (${highestScore} points)`);
        originalLog(`Battle time: ${Math.floor((now - battleStartTime) / 1000)} seconds`);
        
        // Show current scores and execution stats
        if (activeBots.size >= 1) {
          originalLog(`Current scores and execution stats:`);
          const sortedProcesses = [...processes].sort((a, b) => {
            const scoreA = scores.get(a.id) || 0;
            const scoreB = scores.get(b.id) || 0;
            return scoreB - scoreA;
          });
          
          sortedProcesses.forEach(proc => {
            const score = scores.get(proc.id) || 0;
            const active = activeBots.has(proc.id);
            const execStats = cycleHistory[proc.id] || {cycles: 0, lastSeen: -1};
            
            originalLog(`  ${proc.name}: ${score} points (${proc.state}) ${active ? '🟢' : '🔴'}`);
            originalLog(`    Cycles executed: ${execStats.cycles}, Last executed: turn ${execStats.lastSeen}`);
            originalLog(`    PC: 0x${proc.registers?.pc?.toString(16) || 'N/A'}, State: ${proc.state}`);
          });
        }
        
        // Get and show detailed battle system information
        const battleInfo = battleSystem.getSystemState?.() || {};
        if (battleInfo) {
          if (battleInfo.cyclesPerBot) {
            originalLog(`Cycles per bot (battle system tracking):`);
            Object.entries(battleInfo.cyclesPerBot).forEach(([pid, cycles]) => {
              originalLog(`  Bot ${pid} (${botMap[pid]?.name || 'unknown'}): ${cycles} cycles`);
            });
          }
        }
        
        lastStatusUpdate = now;
      }
    }
  };
  
  console.log('\n=== Starting Battle ===\n');
  
  try {
    // Set up instruction execution handlers
    battleSystem.setupExecutionHandlers();
    
    // Start the battle
    const controller = battleSystem.getBattleController();
    controller.start();
    
    // Run the battle with monitoring
    let running = true;
    let completedTurns = 0;
    let realWinner = null;
    
    // We're using the cycleHistory defined earlier
    
    // Now that we've enabled round-robin scheduling in options, let's track what's happening
    
    // Hook into instruction execution to track actual bot execution
    const originalBeforeExecution = battleSystem.battleController.onBeforeExecution;
    battleSystem.battleController.onBeforeExecution = (processId) => {
      // Count executions by bot
      if (!cycleHistory[processId]) {
        cycleHistory[processId] = {cycles: 0, lastSeen: completedTurns};
      }
      cycleHistory[processId].cycles++;
      cycleHistory[processId].lastSeen = completedTurns;
      
      // Track the currently running bot
      if (processId !== runningBot) {
        if (runningBot !== null) {
          originalLog(`Bot ${runningBot} (${botMap[runningBot]?.name}) handed control to Bot ${processId} (${botMap[processId]?.name})`);
        }
        runningBot = processId;
      }
      
      // Call original handler if it exists
      if (originalBeforeExecution) originalBeforeExecution(processId);
    };
    
    // Also track after execution
    const originalAfterExecution = battleSystem.battleController.onAfterExecution;
    battleSystem.battleController.onAfterExecution = (processId) => {
      // Update last activity time
      if (cycleHistory[processId]) {
        cycleHistory[processId].lastSeen = completedTurns;
      }
      
      // Call original handler if it exists
      if (originalAfterExecution) originalAfterExecution(processId);
    };
    
    // Log our strategy
    originalLog("🔄 Using round-robin execution with 128KB memory and 100 cycles per turn");
    originalLog("🔍 Tracking execution of each bot to see why some don't run");
    
    // Run the battle loop
    while (running && completedTurns < options.maxTurns) {
      
      running = controller.nextTurn();
      completedTurns++;
      
      // Run our monitor on each turn
      battleMonitor();
      
      // Check if all processes have terminated but we haven't reached min turns
      const processes = controller.getAllProcessInfo();
      const activeProcesses = processes.filter(p => p.state !== 'Terminated');
      
      // If only 0-1 active processes remain, track the real winner
      if (activeProcesses.length === 1 && realWinner === null) {
        realWinner = activeProcesses[0].id;
        originalLog(`\n🏆 NATURAL WINNER: ${activeProcesses[0].name} is the last bot standing at turn ${completedTurns}!`);
      }
      
      // If no active processes remain, end the battle
      if (activeProcesses.length === 0) {
        originalLog(`\n🏁 No active bots remaining after ${completedTurns} turns - ending battle`);
        break;
      }
      
      // Every 100 turns, output a heartbeat to show progress on long battles
      if (completedTurns % 500 === 0) {
        const elapsedTime = Math.floor((Date.now() - battleStartTime) / 1000);
        originalLog(`\n⏱️ Battle in progress: ${completedTurns} turns completed (${elapsedTime} seconds elapsed)`);
      }
    }
    
    // Get battle results
    const results = controller.getBattleResults();
    
    // Display summarized results
    originalLog('\n\n=== Battle Results ===');
    originalLog(`Total turns completed: ${results.turns}`);
    
    if (results.winner !== null) {
      const winnerProcess = botMap[results.winner];
      originalLog(`\n🏆 WINNER: ${winnerProcess.name} (${winnerProcess.owner}) 🏆`);
      originalLog(`Executed ${results.scores.get(results.winner) || 0} instructions`);
    } else {
      originalLog('No winner - battle ended in a draw');
    }
    
    // Display final scores as a leaderboard
    originalLog('\n=== BATTLE LEADERBOARD ===');
    
    // Get final process info
    const processInfo = controller.getAllProcessInfo();
    
    // Sort processes by score
    const sortedProcesses = [...processInfo].sort((a, b) => {
      const scoreA = results.scores.get(a.id) || 0;
      const scoreB = results.scores.get(b.id) || 0;
      return scoreB - scoreA; // Descending order
    });
    
    // Display leaderboard
    originalLog('Rank | Bot                | Owner     | Score | Status');
    originalLog('-----|-------------------|-----------|-------|--------');
    sortedProcesses.forEach((process, index) => {
      const score = results.scores.get(process.id) || 0;
      const rank = index + 1;
      const isWinner = process.id === results.winner;
      const status = process.state;
      
      originalLog(
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