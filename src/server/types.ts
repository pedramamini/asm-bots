import { BattleState } from "../battle/BattleController";
import { ProcessId } from "../battle/types";

// Database Bot type without runtime properties
export interface BotData {
  id: string;
  name: string;
  code: string;
  owner: string;
  created: Date;
  updated: Date;
}

// Full Bot type with runtime properties
export interface Bot extends BotData {
  memory: Uint8Array;
  pc: number;  // Changed from instructionPointer to pc
  cyclesExecuted: number;
  color: string;
  currentInstruction: string;
}

// Database Battle type without runtime methods
export interface BattleData {
  id: string;
  bots: string[];  // Array of bot IDs
  status: 'pending' | 'running' | 'paused' | 'completed';
  winner?: string;
  startTime?: Date;
  endTime?: Date;
  events: BattleEvent[];
  memorySize?: number;
}

// Full Battle type with runtime methods
export interface Battle extends BattleData {
  memorySize: number;  // Required in runtime
  start(): void;
  pause(): void;
  reset(): void;
  getState(): BattleState;
  addProcess(processId: ProcessId): void;
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
  type: 'battleUpdate' | 'botUpdate' | 'error' | 'botUploaded' | 'executionLog';
  data: Battle | Bot | { message: string } | { botId: string; name: string } | BattleEvent[];
}

export interface RouterContext {
  request: Request;
  response: Response;
}

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
  createProcess(code: string, name: string): Promise<ProcessId>;
}

// Event types for WebSocket messages
export type WebSocketEventType =
  | 'subscribe'    // Subscribe to battle updates
  | 'unsubscribe'  // Unsubscribe from battle updates
  | 'battleUpdate' // Battle state has changed
  | 'botUpdate'    // Bot state has changed
  | 'startBattle'  // Start a battle
  | 'pauseBattle'  // Pause a battle
  | 'resetBattle'  // Reset a battle
  | 'uploadBot'    // Upload a new bot
  | 'executionLog' // Execution log update
  | 'error';       // Error occurred

export interface WebSocketEvent {
  type: WebSocketEventType;
  battleId?: string;
  data?: unknown;
  botData?: {
    name: string;
    code: string;
  };
}