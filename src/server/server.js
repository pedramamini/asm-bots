const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const app = express();
const port = 8000;

// In-memory storage for bots and battles
const bots = new Map();
const battles = new Map();
const clients = new Set();

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Parse JSON bodies
app.use(express.json());

// Serve static files from the web directory
app.use(express.static('/app/src/web'));

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check request received');
  res.send('OK');
});

// API endpoint to upload a bot
app.post('/api/bots', (req, res) => {
  console.log('Uploading bot:', req.body.name);
  const { name, code } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Name and code are required' });
  }

  const botId = Date.now().toString();
  const bot = { id: botId, name, code, state: 'waiting' };
  bots.set(botId, bot);

  // Notify all clients about the new bot
  broadcastToClients({
    type: 'bots',
    data: Array.from(bots.values())
  });

  res.status(201).json(bot);
});

// API endpoint to list bots
app.get('/api/bots', (req, res) => {
  res.json(Array.from(bots.values()));
});

// API endpoint to start a battle
app.post('/api/battles', (req, res) => {
  console.log('Starting battle:', req.body);
  const { botIds } = req.body;
  if (!botIds || !Array.isArray(botIds) || botIds.length < 2) {
    return res.status(400).json({ error: 'At least two bot IDs are required' });
  }

  // Verify all bots exist
  const battleBots = botIds.map(id => bots.get(id)).filter(Boolean);
  if (battleBots.length !== botIds.length) {
    return res.status(400).json({ error: 'One or more bots not found' });
  }

  const battleId = Date.now().toString();
  const battle = {
    id: battleId,
    bots: battleBots,
    status: 'running',
    memory: new Array(0xFFFF).fill(0),
    cycles: 0,
    maxCycles: 80000
  };

  battles.set(battleId, battle);

  // Update bot states
  battleBots.forEach(bot => {
    bot.state = 'running';
    bots.set(bot.id, bot);
  });

  // Notify all clients about the battle and updated bot states
  broadcastToClients({
    type: 'battles',
    data: Array.from(battles.values())
  });
  broadcastToClients({
    type: 'bots',
    data: Array.from(bots.values())
  });

  res.status(201).json(battle);
});

// API endpoint to get battle status
app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  res.json(battle);
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  console.log('Serving index.html');
  res.sendFile('/app/src/web/index.html');
});

// Create HTTP server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}/`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Broadcast to all connected clients
function broadcastToClients(message) {
  const data = JSON.stringify(message);
  console.log('Broadcasting:', data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);

  // Send initial data
  ws.send(JSON.stringify({
    type: 'bots',
    data: Array.from(bots.values())
  }));

  ws.send(JSON.stringify({
    type: 'battles',
    data: Array.from(battles.values())
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data);

      switch (data.type) {
        case 'pause':
          // Handle pause
          break;
        case 'reset':
          // Handle reset
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});