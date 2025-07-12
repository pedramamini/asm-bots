import express, { Request, Response, NextFunction } from 'express';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from "./websocket.js";
import type {
  Storage,
  Bot,
  Battle,
  BotCreateRequest,
  BattleCreateRequest,
  ApiResponse,
} from "./types.js";
import { BattleController, type BattleOptions } from "../battle/BattleController.js";
import { BattleSystem } from "../battle/BattleSystem.js";
import { ProcessManager } from "../battle/ProcessManager.js";
import type { SchedulerOptions, ProcessId } from "../battle/types.js";
import { AssemblyParser } from "../parser/AssemblyParser.js";
import { CodeGenerator } from "../parser/CodeGenerator.js";
import { VERSION_INFO } from '../version.js';

// Constants
const MEMORY_SIZE = 65536; // 64KB

// Initialize ProcessManager with scheduler options
const schedulerOptions: SchedulerOptions = {
  maxProcesses: 100,
  defaultPriority: 1,
  defaultQuantum: 10
};

// Default battle options
const defaultBattleOptions: BattleOptions = {
  maxTurns: 1000,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 256,
  maxLogEntries: 1000
};

const parser = new AssemblyParser();
const codeGenerator = new CodeGenerator();
const battleSystem = new BattleSystem(defaultBattleOptions);
const processManager = battleSystem.getProcessManager();

// Initialize storage
const storage: Storage = {
  bots: new Map<string, Bot>(),
  battles: new Map<string, Battle>(),
  clients: new Map(),
  async createProcess(code: string, name: string) {
    // Parse assembly code
    const parseResult = parser.parse(code);
    if (parseResult.errors.length > 0) {
      throw new Error(`Assembly parsing error for bot "${name}": ${parseResult.errors[0].message} at line ${parseResult.errors[0].line}`);
    }

    // Generate code
    const instructions = codeGenerator.encode(parseResult.tokens, parseResult.symbols);
    const generatedCode = codeGenerator.layout(instructions, parseResult.symbols);

    // Create process
    return processManager.create({
      name,
      owner: 'system',
      entryPoint: generatedCode.entryPoint,
      memorySegments: generatedCode.segments,
    });
  },
  createBattle(battleId: string) {
    // Create a new battle system for each battle
    const newBattleSystem = new BattleSystem(defaultBattleOptions);
    const battleController = newBattleSystem.getBattleController();
    const memorySystem = newBattleSystem.getMemorySystem();
    const battleProcessManager = newBattleSystem.getProcessManager();
    
    const battle: Battle = {
      id: battleId,
      bots: [],
      status: 'pending',
      events: [],
      memorySize: MEMORY_SIZE,
      processes: [],
      battleSystem: newBattleSystem,
      start() {
        this.status = 'running';
        battleController.start();
        return battleController.getState();
      },
      pause() {
        this.status = 'paused';
        battleController.pause();
      },
      reset() {
        this.status = 'pending';
        battleController.reset();
      },
      getState() {
        return battleController.getState();
      },
      addProcess(processId: ProcessId) {
        this.processes?.push(processId);
        battleController.addProcess(processId);
      },
      getMemory() {
        return memorySystem.getMemory();
      },
      executeStep() {
        battleController.nextTurn();
      },
      getProcessManager() {
        return battleProcessManager;
      }
    };
    
    storage.battles.set(battleId, battle);
    return battle;
  }
};

export const app = express();
export const wsServer = new WebSocketServer(storage);

// Middleware
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Version endpoint
app.get("/api/version", (req: Request, res: Response) => {
  const response: ApiResponse<typeof VERSION_INFO> = {
    success: true,
    data: VERSION_INFO,
  };
  res.json(response);
});

// Bot Management Endpoints
app.get("/api/bots", (req: Request, res: Response) => {
  const response: ApiResponse<Bot[]> = {
    success: true,
    data: Array.from(storage.bots.values()),
  };
  res.json(response);
});

app.get("/api/bots/:id", (req: Request, res: Response) => {
  const bot = storage.bots.get(req.params.id);
  if (!bot) {
    res.status(404).json({
      success: false,
      error: "Bot not found",
    });
    return;
  }

  const response: ApiResponse<Bot> = {
    success: true,
    data: bot,
  };
  res.json(response);
});

app.post("/api/bots", (req: Request, res: Response) => {
  const body = req.body as BotCreateRequest;

  if (!body || !body.name || !body.code) {
    res.status(400).json({
      success: false,
      error: "Name and code are required",
    });
    return;
  }

  // Predefined distinct colors for better visualization
  const botColors = [
    "#FF5733", // Red-Orange
    "#33A1FF", // Blue
    "#33FF57", // Green
    "#F033FF", // Purple
    "#FFDD33", // Yellow
    "#33FFF9", // Cyan
    "#FF33A8", // Pink
    "#8933FF", // Violet
  ];
  
  // Create bot with runtime properties
  const bot: Bot = {
    id: randomUUID(),
    name: body.name,
    code: body.code,
    owner: body.owner || "anonymous",
    created: new Date(),
    updated: new Date(),
    memory: new Uint8Array(256), // Default memory size
    pc: 0,
    cyclesExecuted: 0,
    color: botColors[storage.bots.size % botColors.length], // Assign distinct color based on bot count
    currentInstruction: "",
  };

  storage.bots.set(bot.id, bot);

  const response: ApiResponse<Bot> = {
    success: true,
    data: bot,
  };
  res.status(201).json(response);
});

app.delete("/api/bots/:id", (req: Request, res: Response) => {
  if (!storage.bots.delete(req.params.id)) {
    res.status(404).json({
      success: false,
      error: "Bot not found",
    });
    return;
  }
  res.status(204).send();
});

// Battle Operations Endpoints
app.post("/api/battles", async (req: Request, res: Response) => {
  const body = req.body as BattleCreateRequest;

  if (!body || !body.bots || !Array.isArray(body.bots) || body.bots.length < 2) {
    res.status(400).json({
      success: false,
      error: "At least two bots are required",
    });
    return;
  }

  // Validate that all bots exist
  for (const botId of body.bots) {
    if (!storage.bots.has(botId)) {
      res.status(400).json({
        success: false,
        error: `Bot ${botId} not found`,
      });
      return;
    }
  }

  try {
    // Create a new battle system instance for this battle
    const battleSystem = new BattleSystem(defaultBattleOptions);
    
    // Get battle controller from battle system
    const battleController = battleSystem.getBattleController();
    
    
    // Create processes for each bot and add to battle
    const processes = [];
    for (const botId of body.bots) {
      const bot = storage.bots.get(botId)!;
      
      try {
        // Create process from bot code
        const processId = await storage.createProcess(bot.code, bot.name);
        battleController.addProcess(processId);
        processes.push(processId);
      } catch (error) {
        console.error(`Error creating process for bot ${botId}:`, error);
        res.status(400).json({
          success: false,
          error: `Error creating process for bot ${bot.name}: ${error instanceof Error ? error.message : String(error)}`
        });
        return;
      }
    }
    
    // Create battle object
    const battle: Battle = {
      id: randomUUID(),
      bots: body.bots,
      status: 'pending',
      events: [],
      memorySize: defaultBattleOptions.maxMemoryPerProcess,
      processes: processes,
      battleSystem: battleSystem, // Store battle system for later use
      start: () => {
        battleController.start();
        return battleSystem.runBattle(10); // Run 10 turns initially
      },
      pause: () => battleController.pause(),
      reset: () => {
        battleController.reset();
        battleSystem.reset();
      },
      getState: () => battleController.getState(),
      addProcess: (processId) => battleController.addProcess(processId),
      getMemory: () => battleSystem.getMemorySystem().getMemory(),
      executeStep: () => battleController.nextTurn(),
      getProcessManager: () => battleSystem.getProcessManager()
    };

    storage.battles.set(battle.id, battle);

    const response: ApiResponse<Battle> = {
      success: true,
      data: battle,
    };
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating battle:', error);
    res.status(500).json({
      success: false,
      error: `Failed to create battle: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

app.get("/api/battles/:id", (req: Request, res: Response) => {
  const battle = storage.battles.get(req.params.id);
  if (!battle) {
    res.status(404).json({
      success: false,
      error: "Battle not found",
    });
    return;
  }

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  res.json(response);
});

app.post("/api/battles/:id/start", async (req: Request, res: Response) => {
  const battle = storage.battles.get(req.params.id);
  if (!battle) {
    res.status(404).json({
      success: false,
      error: "Battle not found",
    });
    return;
  }

  if (battle.status !== 'pending') {
    res.status(400).json({
      success: false,
      error: "Battle is not in pending state",
    });
    return;
  }

  try {
    battle.status = 'running';
    battle.startTime = new Date();
    
    // Run battle with the battle system
    const results = await battle.start();
    
    // Update battle with results
    battle.results = results;
    
    // If battle completed, update status
    if (results.turns >= defaultBattleOptions.maxTurns || results.winner !== null) {
      battle.status = 'completed';
      battle.endTime = new Date();
    }

    // Notify WebSocket clients about battle start/update
    await wsServer.broadcastBattleUpdate(battle.id);

    const response: ApiResponse<Battle> = {
      success: true,
      data: battle,
    };
    res.json(response);
  } catch (error) {
    console.error(`Error starting battle ${battle.id}:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to start battle: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

// Add an endpoint to run additional turns
app.post("/api/battles/:id/turn", async (req: Request, res: Response) => {
  const battle = storage.battles.get(req.params.id);
  if (!battle) {
    res.status(404).json({
      success: false,
      error: "Battle not found",
    });
    return;
  }

  if (battle.status !== 'running') {
    res.status(400).json({
      success: false,
      error: "Battle is not running",
    });
    return;
  }

  try {
    // Get number of turns to run from request body
    const turns = req.body.turns || 1;
    
    // Run specified number of turns using the battle system
    const battleSystem = battle.battleSystem;
    
    
    const battleController = battleSystem.getBattleController();
    
    // Run turns
    let running = true;
    let completedTurns = 0;
    
    while (running && completedTurns < turns) {
      running = battleController.nextTurn();
      completedTurns++;
      
      if (!running) {
        // Battle has ended
        battle.status = 'completed';
        battle.endTime = new Date();
        break;
      }
    }
    
    // Get battle state
    const state = battleController.getState();
    const results = battleController.getBattleResults();
    
    // Update battle with latest results
    battle.results = results;
    
    // Notify WebSocket clients about battle update
    await wsServer.broadcastBattleUpdate(battle.id);
    
    const response: ApiResponse<{
      state: any;
      turns: number;
      status: string;
    }> = {
      success: true,
      data: {
        state: state,
        turns: completedTurns,
        status: battle.status
      },
    };
    
    res.json(response);
  } catch (error) {
    console.error(`Error running turn for battle ${battle.id}:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to run battle turn: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

// Create WebSocket server
const wss = new WSServer({ noServer: true });

// Handle WebSocket upgrade
export const server = app.listen(8080, () => {
  console.log('API server running on http://localhost:8080');
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wsServer.handleConnection(ws);
  });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});