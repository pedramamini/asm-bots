// Test battle script with minimal output
import { BattleSystem } from './dist/battle/BattleSystem.js';

// Create a battle with modest settings
const battle = new BattleSystem({
  maxTurns: 1000,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 8192,  // 8KB per process
  memorySize: 262144,  // 256KB total memory
  roundRobin: true  // Enable round-robin
});

// Disable ALL debug logging except final results
const originalLog = console.log;
console.log = function(...args) {
  // Only allow specific log messages that we want to see at the end
  if (!args[0] || typeof args[0] !== 'string' ||
     !(args[0].includes('[Turn') || 
      args[0].includes('Process ') || 
      args[0].includes('Process State') || 
      args[0].includes('Debug Scheduling') ||
      args[0].includes('All Processes') ||
      args[0].includes('Round-Robin') ||
      args[0].includes('Scheduling:') ||
      args[0].includes('quantum expired') ||
      args[0].includes('Cycles per process'))) {
    originalLog.apply(console, args);
  }
};

console.log("Starting 4-bot battle with 256KB memory for 1,000 rounds...");

// Load bots
console.log("Loading bots...");
battle.loadBot('./bots/simple.asm', 'Player1');
battle.loadBot('./bots/hunter.asm', 'Player2');
battle.loadBot('./bots/vampire.asm', 'Player3');
battle.loadBot('./bots/fortress.asm', 'Player4');

// Run for 1,000 turns
console.log("Running battle for 1,000 turns...");
const results = battle.runBattle(1000);

// Reset console.log to original
console.log = originalLog;

// Print final results with detailed fairness analysis
const controller = battle.getBattleController();
const stats = controller.getAllProcessInfo();
console.log('\nFinal bot stats:');
stats.forEach(bot => {
  console.log(`Bot: ${bot.name} (${bot.id}) - Cycles: ${bot.cycles}, State: ${bot.state}`);
});

// Calculate fairness metrics
let totalCycles = 0;
const activeBots = stats.filter(bot => bot.name !== 'simple'); // Exclude simple bot which terminates immediately

activeBots.forEach(bot => {
  totalCycles += bot.cycles;
});

const idealShare = totalCycles / activeBots.length;
console.log('\nFairness Analysis:');
console.log(`Total cycles executed by active bots: ${totalCycles}`);
console.log(`Ideal fair share per bot: ${idealShare.toFixed(2)} cycles`);

let maxDeviation = 0;
activeBots.forEach(bot => {
  const deviation = Math.abs(bot.cycles - idealShare);
  const deviationPercent = (deviation / idealShare) * 100;
  console.log(`Bot ${bot.id} (${bot.name}): ${bot.cycles} cycles, deviation: ${deviation.toFixed(2)} (${deviationPercent.toFixed(2)}%)`);
  if (deviation > maxDeviation) maxDeviation = deviation;
});

const fairnessScore = 100 - ((maxDeviation / idealShare) * 100);
console.log(`\nOverall fairness score: ${fairnessScore.toFixed(2)}% (100% = perfectly fair)`);

// Show battle winner
if (results.winner) {
  console.log(`\nWinner: Bot ${results.winner} (${controller.getProcessInfo(results.winner).name})`);
  console.log(`Reason: Last bot running or highest score`);
}

console.log("\nBattle complete!");