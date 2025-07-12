import { BattleSystem } from '../dist/battle/BattleSystem.js';

// Test jump and call instructions
console.log('🧪 Testing Jump and Call Instructions 🧪');

// Create battle system with small memory for easier debugging
const battleSystem = new BattleSystem({
  memorySize: 65536,
  maxTurns: 100,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 1000
});

// Load test bots
try {
  const bot1 = battleSystem.loadBot('./bots/test_spl.asm', 'Splitter');
  console.log(`\nLoaded ${bot1.name} at 0x${bot1.entryPoint.toString(16).toUpperCase()}`);
  
  // Load a simple bot to keep the battle going
  const bot2 = battleSystem.loadBot('./bots/infinite_loop.asm', 'Looper');
  console.log(`Loaded ${bot2.name} at 0x${bot2.entryPoint.toString(16).toUpperCase()}`);
  
  // Start battle
  console.log('\n=== Starting SPL Test ===\n');
  const result = battleSystem.runBattle();
  
  console.log('\n=== Test Complete ===');
  console.log('Winner:', result.winner || 'No winner');
  console.log('Total cycles:', result.cycles);
  
} catch (error) {
  console.error('Error:', error);
}