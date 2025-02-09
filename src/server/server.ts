import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from './api.js';
import type { Request, Response, NextFunction } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve static files from the web directory
app.use(express.static(path.join(__dirname, '../web')));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

// Serve index.html for all other routes
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});