import { MemorySegment } from '../parser/CodeGenerator.js';

export enum ProcessState {
  Ready = 'Ready',
  Running = 'Running',
  Blocked = 'Blocked',
  Terminated = 'Terminated'
}

export interface ProcessContext {
  registers: {
    r0: number;
    r1: number;
    r2: number;
    r3: number;
    sp: number;
    pc: number;
    flags: number;
  };
  memory: MemorySegment[];
  cycles: number;
  state: ProcessState;
  currentInstruction: string;  // Track current instruction being executed
}

export interface Process {
  id: number;
  name: string;
  owner: string;
  context: ProcessContext;
  priority: number;
  quantum: number;
  cyclesUsed: number;
  memoryUsed: number;
  createdAt: number;
  lastRun: number;
}

export interface SchedulerStats {
  totalProcesses: number;
  runningProcess: number | null;
  readyProcesses: number;
  blockedProcesses: number;
  terminatedProcesses: number;
  totalCyclesExecuted: number;
  averageWaitTime: number;
}

export interface ResourceUsage {
  memory: number;
  cycles: number;
  instructions: number;
}

export interface ResourceLimits {
  maxMemory: number;
  maxCycles: number;
  maxInstructions: number;
}

export type ProcessId = number;

export interface ProcessCreateOptions {
  name: string;
  owner: string;
  priority?: number;
  quantum?: number;
  memorySegments: MemorySegment[];
  entryPoint: number;
  resourceLimits?: ResourceLimits;
}

export interface SchedulerOptions {
  defaultQuantum: number;
  defaultPriority: number;
  maxProcesses: number;
}