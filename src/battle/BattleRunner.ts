/**
 * Core Wars Battle Runner
 * Command-line tool for running bot battles
 */

import { BattleSystem } from './BattleSystem.js';
import { BattleOptions } from './BattleController.js';
import { ProcessState } from './types.js';
import fs from 'fs';
import path from 'path';

// Default battle options
const DEFAULT_OPTIONS: BattleOptions = {
  maxTurns: 1000,
  maxCyclesPerTurn: 1000,
  maxMemoryPerProcess: 4096,
  maxLogEntries: 10000
};

export class BattleRunner {
  private battleSystem: BattleSystem;
  private options: BattleOptions;
  private botPaths: string[] = [];
  private botOwners: string[] = [];
  private verbose: boolean = false;
  
  constructor(options: Partial<BattleOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.battleSystem = new BattleSystem(this.options);
  }
  
  public addBot(filePath: string, owner: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Bot file not found: ${filePath}`);
    }
    this.botPaths.push(filePath);
    this.botOwners.push(owner);
  }
  
  public setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
  
  public async runBattle(): Promise<any> {
    // Load all bots
    const loadedBots = [];
    for (let i = 0; i < this.botPaths.length; i++) {
      const botPath = this.botPaths[i];
      const owner = this.botOwners[i];
      
      try {
        const bot = this.battleSystem.loadBot(botPath, owner);
        loadedBots.push(bot);
        
        if (this.verbose) {
          console.log(`Loaded bot: ${bot.name} (owner: ${bot.owner})`);
          console.log(`  Process ID: ${bot.processId}`);
          console.log(`  Entry point: 0x${bot.entryPoint.toString(16).toUpperCase()}`);
          console.log(`  Memory used: ${bot.memoryUsed} bytes`);
          console.log('---------------------------------------------------');
        }
      } catch (error) {
        console.error(`Error loading bot ${path.basename(botPath)}: ${error}`);
        throw error;
      }
    }
    
    if (loadedBots.length < 2) {
      throw new Error('At least two bots are required for a battle');
    }
    
    // Run the battle
    const startTime = Date.now();
    
    if (this.verbose) {
      console.log('Starting battle...');
    }
    
    const results = this.battleSystem.runBattle();
    const endTime = Date.now();
    
    // Print results
    if (this.verbose) {
      console.log('===================================================');
      console.log('Battle Results:');
      console.log(`Duration: ${(endTime - startTime) / 1000} seconds`);
      console.log(`Turns: ${results.turns}`);
      
      console.log('Process info:');
      const controller = this.battleSystem.getBattleController();
      const processInfo = controller.getAllProcessInfo();
      
      for (const process of processInfo) {
        console.log(`  - ${process.name} (owner: ${process.owner})`);
        console.log(`    State: ${process.state}`);
        console.log(`    Cycles used: ${process.cycles}`);
        console.log(`    Memory used: ${process.memoryUsed}`);
      }
      
      if (results.winner !== null) {
        const winnerInfo = processInfo.find(p => p.id === results.winner);
        console.log(`Winner: ${winnerInfo?.name} (owner: ${winnerInfo?.owner})`);
      } else {
        console.log('No winner - battle ended in a draw');
      }
      
      console.log('Scores:');
      results.scores.forEach((score: number, processId: number) => {
        const procInfo = processInfo.find(p => p.id === processId);
        console.log(`  ${procInfo?.name}: ${score}`);
      });
    }
    
    return {
      ...results,
      processes: this.battleSystem.getBattleController().getAllProcessInfo(),
      duration: endTime - startTime
    };
  }
}

// CLI entry point for ES modules
// Check if this is being run directly (not imported)
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the current file's URL and convert to path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if this file is run directly
const isMainModule = process.argv[1] === __filename || process.argv[1] === __filename.replace(/\.ts$/, '.js');

if (isMainModule) {
  const args = process.argv.slice(2);
  let verbose = false;
  let options: Partial<BattleOptions> = {};
  const botFiles: string[] = [];
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-v' || arg === '--verbose') {
      verbose = true;
    } else if (arg === '--max-turns' && i < args.length - 1) {
      options.maxTurns = parseInt(args[++i], 10);
    } else if (arg === '--max-cycles' && i < args.length - 1) {
      options.maxCyclesPerTurn = parseInt(args[++i], 10);
    } else if (arg.endsWith('.asm') && fs.existsSync(arg)) {
      botFiles.push(arg);
    }
  }
  
  if (botFiles.length < 2) {
    console.error('Error: At least two .asm bot files are required');
    process.exit(1);
  }
  
  // Create runner and add bots
  const runner = new BattleRunner(options);
  runner.setVerbose(verbose);
  
  for (const file of botFiles) {
    const owner = 'Player ' + (botFiles.indexOf(file) + 1);
    runner.addBot(file, owner);
  }
  
  // Run the battle
  runner.runBattle()
    .then(() => {
      // Battle completed
      process.exit(0);
    })
    .catch(error => {
      console.error('Error running battle:', error);
      process.exit(1);
    });
}