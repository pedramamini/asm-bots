// Test battle script to run a full battle with 4 bots
import { BattleSystem } from './dist/battle/BattleSystem.js';

console.log("Starting 4-bot battle with 256KB memory for 10,000 rounds...");

// Create a battle with more realistic settings
const battle = new BattleSystem({
  maxTurns: 10000,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 8192,  // 8KB per process
  memorySize: 262144,  // 256KB total memory
  roundRobin: true  // Enable round-robin
});

// Disable excessive debug output
console.log("Loading bots...");
battle.loadBot('./bots/simple.asm', 'Player1');
battle.loadBot('./bots/hunter.asm', 'Player2');
battle.loadBot('./bots/vampire.asm', 'Player3');
battle.loadBot('./bots/fortress.asm', 'Player4');

// Disable all debug logging to get just final results
const originalLog = console.log;
console.log = function(...args) {
  // Skip all debug messages about scheduling and process state
  if (args[0] && typeof args[0] === 'string' && 
     (args[0].includes('[Turn') || 
      args[0].includes('Process ') || 
      args[0].includes('Process State') || 
      args[0].includes('Debug Scheduling') ||
      args[0].includes('Round-Robin') ||
      args[0].includes('Scheduling:') ||
      args[0].includes('Cycles per process'))) {
    return;
  }
  originalLog.apply(console, args);
};

// Run for 10,000 turns
console.log("Running full battle for 10,000 turns...");
const results = battle.runBattle(10000);

// Reset console.log
console.log = originalLog;

// Print final results
const controller = battle.getBattleController();
const stats = controller.getAllProcessInfo();
console.log('\nFinal bot stats:');
stats.forEach(bot => {
  console.log(`Bot: ${bot.name} (${bot.id}) - Cycles: ${bot.cycles}, State: ${bot.state}`);
});

// Show battle winner
if (results.winner) {
  console.log(`\nWinner: Bot ${results.winner} (${controller.getProcessInfo(results.winner).name})`);
  console.log(`Reason: Last bot running or highest score`);
}

console.log("\nBattle complete!");