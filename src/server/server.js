import express from 'express';
import path from 'path';
import { WebSocket, WebSocketServer as WS } from 'ws';
import { fileURLToPath } from 'url';
import { WebSocketServer } from './websocket.js';
import { BattleController } from '../battle/BattleController.js';
import { ProcessManager } from '../battle/ProcessManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 8000;

// Initialize storage
const storage = {
  bots: new Map(),
  battles: new Map(),
  clients: new Map(),
  async createProcess(code, name) {
    const processManager = new ProcessManager({
      defaultQuantum: 100,
      defaultPriority: 1,
      maxProcesses: 10
    });

    // Create process with the bot's code
    const processId = processManager.create({
      name,
      owner: 'user',
      memorySegments: [], // TODO: Parse and compile code to get memory segments
      entryPoint: 0
    });

    return processId;
  }
};

// Create default battle
const processManager = new ProcessManager({
  defaultQuantum: 100,
  defaultPriority: 1,
  maxProcesses: 10
});

const battleController = new BattleController(processManager, {
  maxTurns: 1000,
  maxCyclesPerTurn: 100,
  maxMemoryPerProcess: 1024,
  maxLogEntries: 1000
});

storage.battles.set('default', battleController);

// Create WebSocket server instance
const wsServer = new WebSocketServer(storage);

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Parse JSON bodies
app.use(express.json());

// Serve static files from the web directory
app.use(express.static(path.join(__dirname, '../web')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

// Create HTTP server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}/`);
});

// Create WebSocket server
const wss = new WS({ server });

// Handle WebSocket connections
wss.on('connection', (socket) => {
  wsServer.handleConnection(socket).catch(console.error);
});