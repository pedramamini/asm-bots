import { ProcessManager } from './ProcessManager.js';
import { ProcessId, Process, ProcessState } from './types.js';

export interface BattleState {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed';
  turn: number;
  maxTurns: number;
  processes: ProcessId[];
  winner: ProcessId | null;
  startTime: number;
  endTime: number | null;
  scores: Map<ProcessId, number>;
  logs: ExecutionLog[];
}

export interface ExecutionLog {
  timestamp: number;
  processId: ProcessId;
  instruction: string;
  pc: number;
}

export interface BattleOptions {
  maxTurns: number;
  maxCyclesPerTurn: number;
  maxMemoryPerProcess: number;
  maxLogEntries?: number;
  memorySize?: number;     // Total memory size for the battle
  coreDump?: boolean;      // Whether to dump core memory on crash
  cycleLimit?: number;     // Maximum cycles a process can execute
  timeLimit?: number;      // Maximum time in milliseconds for the battle
}

export class BattleController {
  private state: BattleState;
  private processManager: ProcessManager;
  private options: BattleOptions;

  constructor(processManager: ProcessManager, options: BattleOptions) {
    this.processManager = processManager;
    this.options = {
      ...options,
      maxLogEntries: options.maxLogEntries || 1000
    };
    this.state = this.createInitialState();
  }

  private createInitialState(): BattleState {
    return {
      id: this.generateBattleId(),
      status: 'pending',
      turn: 0,
      maxTurns: this.options.maxTurns,
      processes: [],
      winner: null,
      startTime: Date.now(),
      endTime: null,
      scores: new Map(),
      logs: []
    };
  }

  addProcess(processId: ProcessId): void {
    if (this.state.status !== 'pending' && this.state.status !== 'paused') {
      throw new Error('Cannot add processes while battle is running or completed');
    }

    const process = this.processManager.getProcess(processId);
    this.validateProcess(process);

    this.state.processes.push(processId);
    this.state.scores.set(processId, 0);
  }

  start(): void {
    if (this.state.processes.length < 1) {
      throw new Error('At least one process is required for a battle');
    }

    if (this.state.status === 'completed') {
      throw new Error('Battle is already completed');
    }

    this.state.status = 'running';
    if (this.state.turn === 0) {
      this.state.startTime = Date.now();
    }
  }

  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
    }
  }

  reset(): void {
    // Reset all processes
    for (const processId of this.state.processes) {
      this.processManager.reset(processId);
    }

    // Reset battle state
    this.state = {
      ...this.createInitialState(),
      processes: [...this.state.processes], // Keep existing processes
      scores: new Map(this.state.processes.map(pid => [pid, 0]))
    };
  }

  nextTurn(): boolean {
    if (this.state.status !== 'running') {
      return false;
    }

    if (this.state.turn >= this.state.maxTurns) {
      console.log(`Reached maximum turns (${this.state.maxTurns})`);
      this.endBattle();
      return false;
    }

    // Execute each process for their turn
    let cyclesThisTurn = 0;
    let processesRun = new Set<ProcessId>();
    
    // Get active processes
    const activeProcessCount = this.state.processes.filter(pid => {
      const process = this.processManager.getProcess(pid);
      return process.context.state !== ProcessState.Terminated;
    }).length;
    
    // If no active processes, end the battle
    if (activeProcessCount === 0) {
      console.log("No active processes remaining - ending battle");
      this.endBattle();
      return false;
    }

    // Run at least one cycle per active process, if possible
    const minCyclesPerProcess = 5; // Run at least 5 cycles per active process
    const targetMinCycles = activeProcessCount * minCyclesPerProcess;

    // Run until we hit max cycles or all processes have run enough cycles
    while (cyclesThisTurn < this.options.maxCyclesPerTurn) {
      // Schedule next process
      const runningProcess = this.processManager.schedule();
      if (runningProcess === null) {
        // No processes ready to run
        break;
      }

      // Log execution
      const process = this.processManager.getProcess(runningProcess);
      this.logExecution(runningProcess, process);

      // Emit pre-execution event (if implemented)
      this.onBeforeExecution?.(runningProcess);

      // The actual instruction execution happens in BattleSystem
      // via the onBeforeExecution event

      // Update score and cycles
      const currentScore = this.state.scores.get(runningProcess) || 0;
      this.state.scores.set(runningProcess, currentScore + 1);
      cyclesThisTurn++;
      processesRun.add(runningProcess);

      // Emit post-execution event (if implemented)
      this.onAfterExecution?.(runningProcess);

      // Break conditions:
      
      // 1. If we've executed at least the target minimum cycles and all active processes
      // have had a chance to run, we can end the turn early
      if (cyclesThisTurn >= targetMinCycles && 
          processesRun.size >= activeProcessCount) {
        break;
      }

      // 2. If we've hit max cycles, always break
      if (cyclesThisTurn >= this.options.maxCyclesPerTurn) {
        break;
      }
    }

    // Update turn count
    this.state.turn++;

    // Debug output on some turns
    if (this.state.turn % 10 === 0) {
      const activeProcesses = this.state.processes.filter(pid => {
        const process = this.processManager.getProcess(pid);
        return process.context.state !== ProcessState.Terminated;
      });
      
      console.log(`Turn ${this.state.turn} completed: ${activeProcesses.length} active processes, ${cyclesThisTurn} cycles executed`);
    }

    // Check victory conditions after each turn
    if (this.checkVictory()) {
      this.endBattle();
      return false;
    }

    return true;
  }

  // Event handlers for instruction execution
  public onBeforeExecution?: (processId: ProcessId) => void;
  public onAfterExecution?: (processId: ProcessId) => void;

  private logExecution(processId: ProcessId, process: Process): void {
    const log: ExecutionLog = {
      timestamp: Date.now(),
      processId,
      instruction: process.context.currentInstruction,
      pc: process.context.registers.pc
    };

    this.state.logs.push(log);

    // Keep log size under control
    if (this.state.logs.length > this.options.maxLogEntries!) {
      this.state.logs = this.state.logs.slice(-this.options.maxLogEntries!);
    }
  }

  checkVictory(): boolean {
    // Count active processes
    const activeProcesses = this.state.processes.filter(pid => {
      const process = this.processManager.getProcess(pid);
      return process.context.state !== ProcessState.Terminated;
    });

    // If only one process remains active, it's the winner
    if (activeProcesses.length === 1) {
      this.state.winner = activeProcesses[0];
      return true;
    }

    // If no processes are active or max turns reached, winner is the one with highest score
    if (activeProcesses.length === 0 || this.state.turn >= this.state.maxTurns) {
      this.determineWinnerByScore();
      return true;
    }

    return false;
  }

  private determineWinnerByScore(): void {
    let highestScore = -1;
    let lastActiveProcess: ProcessId | null = null;
    let highestScoringProcess: ProcessId | null = null;

    // First check if any processes are still active
    const activeProcesses = this.state.processes.filter(pid => {
      const process = this.processManager.getProcess(pid);
      return process.context.state !== ProcessState.Terminated;
    });

    if (activeProcesses.length === 1) {
      // Only one active process - it's the winner
      this.state.winner = activeProcesses[0];
      return;
    }

    // If all processes terminated in the same turn, use the score to determine winner
    this.state.scores.forEach((score, processId) => {
      const process = this.processManager.getProcess(processId);
      
      // Track the last active process (the one that survived the longest)
      if (process.lastRun > 0) {
        if (lastActiveProcess === null || 
            process.lastRun > this.processManager.getProcess(lastActiveProcess).lastRun) {
          lastActiveProcess = processId;
        }
      }
      
      // Also track the highest scoring process
      if (score > highestScore) {
        highestScore = score;
        highestScoringProcess = processId;
      }
    });

    // Prefer the process that survived longest, but if they all terminated at the same time,
    // use the highest scoring one
    this.state.winner = lastActiveProcess !== null ? lastActiveProcess : highestScoringProcess;
    
    console.log("Winner determination:", {
      activeProcesses: activeProcesses.length,
      lastActiveProcess,
      highestScoringProcess,
      winner: this.state.winner
    });
  }

  private endBattle(): void {
    this.state.status = 'completed';
    this.state.endTime = Date.now();

    // Terminate all processes
    for (const processId of this.state.processes) {
      this.processManager.terminate(processId);
    }
  }

  getState(): BattleState {
    return {
      ...this.state,
      scores: new Map(this.state.scores)
    };
  }

  saveState(): string {
    const serializedState = {
      ...this.state,
      scores: Array.from(this.state.scores.entries())
    };
    return JSON.stringify(serializedState);
  }

  loadState(serializedState: string): void {
    const parsed = JSON.parse(serializedState);
    this.state = {
      ...parsed,
      scores: new Map(parsed.scores)
    };
  }

  private validateProcess(process: Process): void {
    if (process.memoryUsed > this.options.maxMemoryPerProcess) {
      throw new Error(`Process ${process.id} exceeds maximum memory limit`);
    }
  }

  private generateBattleId(): string {
    return `battle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public getBattleResults(): {
    winner: ProcessId | null;
    scores: Map<ProcessId, number>;
    duration: number;
    turns: number;
  } {
    return {
      winner: this.state.winner,
      scores: new Map(this.state.scores),
      duration: this.state.endTime 
        ? this.state.endTime - this.state.startTime 
        : Date.now() - this.state.startTime,
      turns: this.state.turn
    };
  }

  public getProcessInfo(processId: ProcessId): {
    id: ProcessId;
    name: string;
    owner: string;
    cycles: number;
    state: ProcessState;
    memoryUsed: number;
  } {
    const process = this.processManager.getProcess(processId);
    return {
      id: process.id,
      name: process.name,
      owner: process.owner,
      cycles: process.cyclesUsed,
      state: process.context.state,
      memoryUsed: process.memoryUsed
    };
  }

  public getAllProcessInfo(): Array<{
    id: ProcessId;
    name: string;
    owner: string;
    cycles: number;
    state: ProcessState;
    memoryUsed: number;
  }> {
    return this.state.processes.map(id => this.getProcessInfo(id));
  }
}