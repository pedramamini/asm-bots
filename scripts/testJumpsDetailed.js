import { BattleSystem } from '../dist/battle/BattleSystem.js';

// Test jump and call instructions with detailed output
console.log('🧪 Testing Jump and Call Instructions (Detailed) 🧪');

// Create battle system with fixed memory allocation
const battleSystem = new BattleSystem({
  memorySize: 65536,
  maxTurns: 10,
  maxCyclesPerTurn: 20,
  maxMemoryPerProcess: 1000
});

// Override the random memory allocation for consistent testing
battleSystem.codeGenerator.baseAddress = 0x1000;

// Load test bot
try {
  const bot1 = battleSystem.loadBot('./bots/test_jumps.asm', 'Tester');
  console.log(`\nLoaded ${bot1.name} at 0x${bot1.entryPoint.toString(16).toUpperCase()}`);
  
  // Start battle with just one bot (it will win by default but we can see execution)
  console.log('\n=== Starting Test ===\n');
  const result = battleSystem.runBattle();
  
  console.log('\n=== Test Complete ===');
  
} catch (error) {
  console.error('Error:', error);
}