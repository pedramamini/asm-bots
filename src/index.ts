/**
 * ASM-Bots Entry Point
 * Initializes the Core Wars battle server and API
 */

import { server } from './server/api.js';
import fs from 'fs';
import path from 'path';

// Ensure required directories exist
const botsDir = path.join(process.cwd(), 'bots');
if (!fs.existsSync(botsDir)) {
  console.log('Creating bots directory...');
  fs.mkdirSync(botsDir, { recursive: true });
}

// Log directories
console.log('Bot directory:', botsDir);

// Start server (handled in api.js)
console.log('Core Wars server is running!');
console.log('API available at: http://localhost:8080/api');
console.log('WebSocket available at: ws://localhost:8080/ws');
console.log('Press Ctrl+C to stop the server');

// Handle process shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server terminated');
    process.exit(0);
  });
});