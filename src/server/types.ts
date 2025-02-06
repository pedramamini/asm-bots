import { Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";

export interface Bot {
  id: string;
  name: string;
  code: string;
  owner: string;
  created: Date;
  updated: Date;
}

export interface Battle {
  id: string;
  bots: string[];
  status: 'pending' | 'running' | 'completed';
  winner?: string;
  startTime?: Date;
  endTime?: Date;
  events: BattleEvent[];
}

export interface BattleEvent {
  timestamp: number;
  type: 'instruction' | 'memory' | 'status' | 'victory';
  botId: string;
  data: {
    address?: number;
    value?: number;
    instruction?: string;
    state?: string;
    winner?: string;
  };
}

export interface WebSocketMessage {
  type: 'battleUpdate' | 'botUpdate' | 'error';
  data: Battle | Bot | { message: string };
}

export type RouterContext = Context;

export interface BotCreateRequest {
  name: string;
  code: string;
  owner?: string;
}

export interface BattleCreateRequest {
  bots: string[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// WebSocket client tracking
export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>; // Battle IDs the client is subscribed to
}

// In-memory storage types
export interface Storage {
  bots: Map<string, Bot>;
  battles: Map<string, Battle>;
  clients: Map<string, WebSocketClient>;
}

// Event types for WebSocket messages
export type WebSocketEventType =
  | 'subscribe'   // Subscribe to battle updates
  | 'unsubscribe' // Unsubscribe from battle updates
  | 'battleUpdate'// Battle state has changed
  | 'botUpdate'   // Bot state has changed
  | 'error';      // Error occurred

export interface WebSocketEvent {
  type: WebSocketEventType;
  battleId?: string;
  data?: unknown;
}