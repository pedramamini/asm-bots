import { WebSocket } from 'ws';
import { WebSocketClient, WebSocketEvent, Storage, Battle } from "./types.js";
import { ProcessState } from "../battle/types.js";
import { AssemblyParser } from "../parser/AssemblyParser.js";
import { CodeGenerator } from "../parser/CodeGenerator.js";

export class WebSocketServer {
  private storage: Storage;
  private parser: AssemblyParser;
  private codeGenerator: CodeGenerator;

  constructor(storage: Storage) {
    this.storage = storage;
    this.parser = new AssemblyParser();
    this.codeGenerator = new CodeGenerator();
  }

  async handleConnection(socket: WebSocket): Promise<void> {
    const clientId = crypto.randomUUID();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
    };

    this.storage.clients.set(clientId, client);

    try {
      socket.on('message', async (data) => {
        await this.handleWebSocketMessage(clientId, data.toString());
      });

      socket.on('close', () => {
        this.handleDisconnect(clientId);
      });

      socket.on('error', (e) => {
        console.error(`WebSocket error:`, e);
        this.handleDisconnect(clientId);
      });
    } catch (err) {
      console.error(`WebSocket error:`, err);
      this.handleDisconnect(clientId);
    }
  }

  private async handleWebSocketMessage(clientId: string, message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as WebSocketEvent;
      const client = this.storage.clients.get(clientId);

      if (!client) {
        console.error(`Client ${clientId} not found`);
        return;
      }

      switch (event.type) {
        case 'subscribe':
          if (event.data && event.data.events) {
            // Client subscribes to event types, not specific battles
            client.subscriptions.add('all');
          }
          break;

        case 'battle.create':
          if (event.data && event.data.bots) {
            await this.handleCreateBattle(clientId, event.data.bots);
          }
          break;

        case 'battle.start':
          if (event.data && event.data.battleId) {
            await this.handleStartBattle(event.data.battleId);
          }
          break;

        case 'battle.pause':
          if (event.data && event.data.battleId) {
            await this.handlePauseBattle(event.data.battleId);
          }
          break;

        case 'battle.reset':
          if (event.data && event.data.battleId) {
            await this.handleResetBattle(event.data.battleId);
          }
          break;

        case 'battle.step':
          if (event.data && event.data.battleId) {
            await this.handleStepBattle(event.data.battleId, event.data.steps || 1);
          }
          break;

        case 'uploadBot':
          if (event.botData) {
            await this.handleBotUpload(client.id, event.botData);
          }
          break;

        default:
          console.warn(`Unknown WebSocket event type: ${event.type}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error(`Error handling WebSocket message:`, errorMessage);
      await this.sendError(clientId, errorMessage);
    }
  }

  private async createProcessForBattle(battle: any, code: string, name: string): Promise<number> {
    // Parse assembly code
    const parseResult = this.parser.parse(code);
    if (parseResult.errors.length > 0) {
      throw new Error(`Assembly parsing error for bot "${name}": ${parseResult.errors[0].message} at line ${parseResult.errors[0].line}`);
    }

    // Generate code
    const instructions = this.codeGenerator.encode(parseResult.tokens, parseResult.symbols);
    let generatedCode = this.codeGenerator.layout(instructions, parseResult.symbols);
    
    // Get memory size from battle
    const memorySize = battle.memorySize || 65536;
    
    // Randomly place the bot in memory
    const maxStartAddress = memorySize - 1024; // Leave some room at the end
    const memoryBase = Math.floor(Math.random() * maxStartAddress);
    
    // Relocate to the random address
    this.codeGenerator.relocate(memoryBase);
    
    // Get the layout again after relocation to get updated segment addresses
    generatedCode = this.codeGenerator.layout(instructions, parseResult.symbols);
    
    // Update entry point after relocation - randomize within the code segment
    if (generatedCode.segments.length > 0) {
      const codeSegment = generatedCode.segments[0];
      // Random offset within the code segment (but aligned to instruction boundary)
      const maxOffset = Math.max(0, codeSegment.size - 3); // Leave room for at least one instruction
      const randomOffset = Math.floor(Math.random() * (maxOffset / 3)) * 3; // Align to 3-byte boundary
      generatedCode.entryPoint = codeSegment.start + randomOffset;
    }
    
    console.log(`Bot ${name} placed at 0x${memoryBase.toString(16)}, random PC: 0x${generatedCode.entryPoint.toString(16)}`);

    // Create process in the battle's process manager
    const processManager = battle.getProcessManager();
    const processId = processManager.create({
      name,
      owner: 'system',
      entryPoint: generatedCode.entryPoint,
      memorySegments: generatedCode.segments,
    });
    
    // Load the code into the battle's memory system
    const memorySystem = battle.battleSystem.getMemorySystem();
    // Set ownership for initial code
    memorySystem.setCurrentProcess(processId);
    for (const segment of generatedCode.segments) {
      for (let i = 0; i < segment.data.length; i++) {
        const address = segment.start + i;
        memorySystem.write(address, segment.data[i]);
      }
    }
    // Clear current process
    memorySystem.setCurrentProcess(null);
    
    return processId;
  }

  private async handleCreateBattle(clientId: string, bots: Array<{name: string, code: string, owner: string}>): Promise<void> {
    try {
      const battleId = crypto.randomUUID();
      
      // Create battle first
      const battle = this.storage.createBattle(battleId);
      const processIds: number[] = [];
      
      // Create processes for each bot in the battle's process manager
      for (let index = 0; index < bots.length; index++) {
        const bot = bots[index];
        const processId = await this.createProcessForBattle(battle, bot.code, bot.name);
        processIds.push(processId);
        battle.addProcess(processId);
        
        // Send initial memory state for this bot
        const memorySystem = battle.battleSystem.getMemorySystem();
        const memory = battle.getMemory();
        const processManager = battle.battleSystem.getProcessManager();
        const process = processManager.getProcess(processId);
        
        // Send memory updates for this bot's segments
        const memoryUpdates: Array<{address: number, value: number, owner: number}> = [];
        for (const segment of process.context.memory) {
          for (let addr = segment.start; addr < segment.start + segment.size; addr++) {
            if (memory[addr] !== 0) {
              memoryUpdates.push({
                address: addr,
                value: memory[addr],
                owner: processId
              });
            }
          }
        }
        
        if (memoryUpdates.length > 0) {
          await this.broadcastToSubscribers(battleId, {
            type: 'memory.update',
            data: { updates: memoryUpdates }
          });
        }
      }
      
      // Send battle created event
      await this.sendMessage(clientId, {
        type: 'battle.created',
        data: {
          battleId,
          processes: processIds.map((id, index) => ({
            id,
            name: bots[index].name,
            owner: bots[index].owner
          }))
        }
      });
      
      // Subscribe client to this battle
      const client = this.storage.clients.get(clientId);
      if (client) {
        client.subscriptions.add(battleId);
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create battle';
      await this.sendError(clientId, errorMessage);
    }
  }

  private async handleStartBattle(battleId: string): Promise<void> {
    console.log(`Starting battle ${battleId}`);
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    console.log(`Battle state before start:`, battle.getState());
    battle.start();
    console.log(`Battle state after start:`, battle.getState());
    
    // Send battle started event to all subscribed clients
    await this.broadcastToSubscribers(battleId, {
      type: 'battle.started',
      data: { battleId }
    });
    
    // Start sending regular updates
    this.startBattleUpdates(battleId);
  }

  private async handlePauseBattle(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    battle.pause();
    
    // Send battle paused event
    await this.broadcastToSubscribers(battleId, {
      type: 'battle.paused',
      data: { battleId }
    });
    
    await this.broadcastBattleUpdate(battleId);
  }

  private async handleResetBattle(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    battle.reset();
    
    // Send battle reset event
    await this.broadcastToSubscribers(battleId, {
      type: 'battle.reset',
      data: { battleId }
    });
    
    await this.broadcastBattleUpdate(battleId);
  }

  private async handleBotUpload(clientId: string, botData: { name: string; code: string }): Promise<void> {
    try {
      // Create a new process for the bot
      const processId = await this.storage.createProcess(botData.code, botData.name);

      // Add process to default battle
      const battle = this.storage.battles.get('default');
      if (battle) {
        battle.addProcess(processId);
      }

      // Send confirmation to client
      await this.sendMessage(clientId, {
        type: 'botUploaded',
        data: {
          botId: processId,
          name: botData.name
        }
      });

      // Broadcast battle update to all subscribers
      await this.broadcastBattleUpdate('default');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload bot';
      await this.sendError(clientId, errorMessage);
    }
  }

  private async handleSubscribe(client: WebSocketClient, battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      await this.sendError(client.id, `Battle ${battleId} not found`);
      return;
    }

    client.subscriptions.add(battleId);

    // Send initial state
    await this.sendMessage(client.id, {
      type: 'battleUpdate',
      data: battle.getState()
    });

    // Send execution logs if any
    const logs = battle.getState().logs;
    if (logs.length > 0) {
      await this.sendMessage(client.id, {
        type: 'executionLog',
        data: logs
      });
    }
  }

  private async handleUnsubscribe(client: WebSocketClient, battleId: string): Promise<void> {
    client.subscriptions.delete(battleId);
  }

  private handleDisconnect(clientId: string): void {
    const client = this.storage.clients.get(clientId);
    if (client) {
      client.socket.close();
      this.storage.clients.delete(clientId);
    }
  }

  async broadcastBattleUpdate(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) return;

    const battleState = battle.getState();
    const battleUpdate = {
      type: 'battleUpdate',
      data: battleState
    };

    const executionLogUpdate = {
      type: 'executionLog',
      data: battleState.logs
    };

    const promises: Promise<void>[] = [];

    for (const [clientId, client] of this.storage.clients) {
      if (client.subscriptions.has(battleId)) {
        promises.push(
          this.sendMessage(clientId, battleUpdate),
          this.sendMessage(clientId, executionLogUpdate)
        );
      }
    }

    await Promise.all(promises);
  }

  private async sendMessage(clientId: string, message: unknown): Promise<void> {
    const client = this.storage.clients.get(clientId);
    if (!client) return;

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      client.socket.send(messageStr);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error sending message';
      console.error(`Error sending message to client ${clientId}:`, errorMessage);
      this.handleDisconnect(clientId);
    }
  }

  private async sendError(clientId: string, message: string): Promise<void> {
    await this.sendMessage(clientId, {
      type: 'error',
      data: { message },
    });
  }
  
  private async handleStepBattle(battleId: string, steps: number): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    // Execute specified number of steps
    for (let i = 0; i < steps; i++) {
      battle.executeStep();
    }
    
    await this.sendBattleUpdate(battleId);
  }
  
  private battleIntervals = new Map<string, NodeJS.Timeout>();
  
  private startBattleUpdates(battleId: string): void {
    console.log(`Starting update interval for battle ${battleId}`);
    // Clear any existing interval
    const existingInterval = this.battleIntervals.get(battleId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }
    
    let updateCount = 0;
    // Send updates every 50ms (20 FPS)
    const interval = setInterval(async () => {
      const battle = this.storage.battles.get(battleId);
      if (!battle || battle.getState().status !== 'running') {
        console.log(`Stopping updates for battle ${battleId}, status: ${battle?.getState().status}`);
        clearInterval(interval);
        this.battleIntervals.delete(battleId);
        return;
      }
      
      updateCount++;
      if (updateCount % 20 === 1) { // Log every second
        console.log(`Sending update #${updateCount} for battle ${battleId}`);
      }
      
      // Execute a step
      battle.executeStep();
      
      await this.sendBattleUpdate(battleId);
    }, 50);
    
    this.battleIntervals.set(battleId, interval);
  }
  
  private async sendBattleUpdate(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) return;
    
    const state = battle.getState();
    
    // Send memory updates - more comprehensive sampling
    const memory = battle.getMemory();
    const processManager = battle.battleSystem.getProcessManager();
    
    // Get ownership information from tracked memory system
    const memorySystem = battle.battleSystem.getMemorySystem();
    const owners = memorySystem.getOwners();
    
    // Send memory updates with actual ownership
    const memoryUpdates: Array<{address: number, value: number, owner: number}> = [];
    for (let addr = 0; addr < memory.length; addr++) {
      if (memory[addr] !== 0 && owners[addr] !== 0) {
        memoryUpdates.push({
          address: addr,
          value: memory[addr],
          owner: owners[addr]
        });
      }
    }
    
    await this.broadcastToSubscribers(battleId, {
      type: 'memory.update',
      data: {
        updates: memoryUpdates
      }
    });
    
    // Send process updates with PC tracking for execution trails
    for (const processId of state.processes) {
      try {
        const process = processManager.getProcess(processId);
        if (process) {
          const pc = process.context.registers.pc;
          
          // Send PC update for memory visualization trails
          await this.broadcastToSubscribers(battleId, {
            type: 'memory.access',
            data: {
              address: pc,
              type: 'execute',
              processId: processId
            }
          });
          
          // Calculate memory footprint for this process
          let memoryFootprint = 0;
          for (const segment of process.context.memory) {
            memoryFootprint += segment.size;
          }
          
          // Debug log memory segments
          if (state.turn % 100 === 0) {
            console.log(`Process ${processId} memory segments:`, process.context.memory.map(s => ({
              name: s.name,
              start: `0x${s.start.toString(16)}`,
              size: s.size
            })));
            console.log(`Process ${processId} total memory footprint: ${memoryFootprint} bytes`);
          }
          
          // Send process state update
          await this.broadcastToSubscribers(battleId, {
            type: 'process.update',
            data: {
              id: processId,
              pc: pc,
              state: process.context.state,
              cycles: state.turn,
              instruction: process.context.currentInstruction || 'unknown',
              memoryFootprint: memoryFootprint
            }
          });
        }
      } catch (error) {
        // Process might be terminated, skip
      }
    }
    
    // Calculate actual memory usage
    let usedMemory = 0;
    for (let i = 0; i < memory.length; i++) {
      if (memory[i] !== 0) {
        usedMemory++;
      }
    }
    
    // Send battle metrics
    await this.broadcastToSubscribers(battleId, {
      type: 'battle.update',
      data: {
        turn: state.turn,
        metrics: {
          cyclesPerSecond: 200, // Current execution speed
          memoryUsage: (usedMemory / memory.length) * 100,
          battleProgress: Math.min((state.turn / 10000) * 100, 100) // Cap at 100%
        }
      }
    });
    
    // Check for battle end
    const activeProcesses = state.processes.filter(pid => {
      try {
        const process = processManager.getProcess(pid);
        return process && process.context.state !== ProcessState.Terminated;
      } catch {
        return false;
      }
    });
    
    if (activeProcesses.length <= 1 && state.status === 'running') {
      battle.pause();
      let winnerId = activeProcesses[0] || null;
      let winnerStats = null;
      
      // If we have a winner, gather their stats
      if (winnerId) {
        try {
          const winnerProcess = processManager.getProcess(winnerId);
          let memoryFootprint = 0;
          for (const segment of winnerProcess.context.memory) {
            memoryFootprint += segment.size;
          }
          
          winnerStats = {
            name: winnerProcess.name,
            owner: winnerProcess.owner,
            memoryFootprint: memoryFootprint,
            cyclesExecuted: winnerProcess.cyclesUsed,
            finalPC: winnerProcess.context.registers.pc
          };
        } catch {
          // Process not found
        }
      }
      
      // If multiple processes remain, determine winner by memory footprint
      if (activeProcesses.length > 1) {
        let maxFootprint = 0;
        winnerId = null;
        
        for (const pid of activeProcesses) {
          try {
            const process = processManager.getProcess(pid);
            let footprint = 0;
            for (const segment of process.context.memory) {
              footprint += segment.size;
            }
            if (footprint > maxFootprint) {
              maxFootprint = footprint;
              winnerId = pid;
              
              // Update winner stats
              winnerStats = {
                name: process.name,
                owner: process.owner,
                memoryFootprint: footprint,
                cyclesExecuted: process.cyclesUsed,
                finalPC: process.context.registers.pc
              };
            }
          } catch {
            // Skip if process not found
          }
        }
      }
      
      await this.broadcastToSubscribers(battleId, {
        type: 'battle.ended',
        data: {
          battleId,
          winner: winnerId,
          reason: activeProcesses.length > 1 ? 'memory_footprint' : 'last_standing',
          stats: winnerStats,
          totalTurns: state.turn
        }
      });
    }
  }
  
  private async broadcastToSubscribers(battleId: string, message: any): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [clientId, client] of this.storage.clients) {
      if (client.subscriptions.has(battleId) || client.subscriptions.has('all')) {
        promises.push(this.sendMessage(clientId, message));
      }
    }
    
    await Promise.all(promises);
  }
}