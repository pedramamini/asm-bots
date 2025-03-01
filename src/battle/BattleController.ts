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
      this.endBattle();
      return false;
    }

    // Execute each process for their turn
    let cyclesThisTurn = 0;
    let processesRun = new Set<ProcessId>();

    // Run until we hit max cycles or all processes have run
    while (cyclesThisTurn < this.options.maxCyclesPerTurn) {
      // Schedule next process
      const runningProcess = this.processManager.schedule();
      if (runningProcess === null) {
        break;
      }

      // Log execution
      const process = this.processManager.getProcess(runningProcess);
      this.logExecution(runningProcess, process);

      // Emit pre-execution event (if implemented)
      this.onBeforeExecution?.(runningProcess);

      // The actual instruction execution would happen here via ExecutionUnit
      // in the BattleSystem class. Since this class doesn't have direct
      // access to the ExecutionUnit, we'll just update the program counter
      // and state here, and let the BattleSystem handle the actual execution.

      // Update score and cycles
      const currentScore = this.state.scores.get(runningProcess) || 0;
      this.state.scores.set(runningProcess, currentScore + 1);
      cyclesThisTurn++;
      processesRun.add(runningProcess);

      // Emit post-execution event (if implemented)
      this.onAfterExecution?.(runningProcess);

      // If all processes have run and we've used at least one cycle per process, break
      if (processesRun.size === this.state.processes.length && cyclesThisTurn >= this.state.processes.length) {
        break;
      }

      // If we've hit max cycles, break
      if (cyclesThisTurn >= this.options.maxCyclesPerTurn) {
        break;
      }
    }

    this.state.turn++;

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
    let winner: ProcessId | null = null;

    this.state.scores.forEach((score, processId) => {
      if (score > highestScore) {
        highestScore = score;
        winner = processId;
      }
    });

    this.state.winner = winner;
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