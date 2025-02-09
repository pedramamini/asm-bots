import express from 'express';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
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
import { ProcessManager } from "../battle/ProcessManager.js";
import type { SchedulerOptions } from "../battle/types.js";

// Initialize ProcessManager with scheduler options
const schedulerOptions: SchedulerOptions = {
  maxProcesses: 100,
  defaultPriority: 1,
  defaultQuantum: 10
};

const processManager = new ProcessManager(schedulerOptions);

// Initialize storage
const storage: Storage = {
  bots: new Map<string, Bot>(),
  battles: new Map<string, Battle>(),
  clients: new Map(),
  async createProcess(code: string, name: string) {
    return processManager.create({
      name,
      code,
      owner: 'system',
      entryPoint: 0,
      memorySegments: [{ start: 0, size: 256, data: new Uint8Array(256) }]
    });
  }
};

export const app = express();
export const wsServer = new WebSocketServer(storage);

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Bot Management Endpoints
app.get("/api/bots", (req, res) => {
  const response: ApiResponse<Bot[]> = {
    success: true,
    data: Array.from(storage.bots.values()),
  };
  res.json(response);
});

app.get("/api/bots/:id", (req, res) => {
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

app.post("/api/bots", (req, res) => {
  const body = req.body as BotCreateRequest;

  if (!body || !body.name || !body.code) {
    res.status(400).json({
      success: false,
      error: "Name and code are required",
    });
    return;
  }

  // Create bot with runtime properties
  const bot: Bot = {
    id: crypto.randomUUID(),
    name: body.name,
    code: body.code,
    owner: body.owner || "anonymous",
    created: new Date(),
    updated: new Date(),
    memory: new Uint8Array(256), // Default memory size
    pc: 0,
    cyclesExecuted: 0,
    color: `#${Math.floor(Math.random()*16777215).toString(16)}`, // Random color
    currentInstruction: "",
  };

  storage.bots.set(bot.id, bot);

  const response: ApiResponse<Bot> = {
    success: true,
    data: bot,
  };
  res.status(201).json(response);
});

app.delete("/api/bots/:id", (req, res) => {
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
app.post("/api/battles", (req, res) => {
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

  // Create battle controller with runtime methods
  const battleOptions: BattleOptions = {
    maxTurns: 1000,
    maxCyclesPerTurn: 100,
    maxMemoryPerProcess: 256,
    maxLogEntries: 1000
  };

  const battleController = new BattleController(processManager, battleOptions);
  const battle: Battle = {
    id: crypto.randomUUID(),
    bots: body.bots,
    status: 'pending',
    events: [],
    memorySize: 256, // Default memory size
    start: () => battleController.start(),
    pause: () => battleController.pause(),
    reset: () => battleController.reset(),
    getState: () => battleController.getState(),
    addProcess: (processId) => battleController.addProcess(processId),
  };

  storage.battles.set(battle.id, battle);

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  res.status(201).json(response);
});

app.get("/api/battles/:id", (req, res) => {
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

app.post("/api/battles/:id/start", async (req, res) => {
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

  battle.status = 'running';
  battle.startTime = new Date();
  battle.start();

  // Notify WebSocket clients about battle start
  await wsServer.broadcastBattleUpdate(battle.id);

  const response: ApiResponse<Battle> = {
    success: true,
    data: battle,
  };
  res.json(response);
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
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});