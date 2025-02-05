import { ProcessManager } from './ProcessManager';
import { ProcessId, Process, ProcessState } from './types';

export interface BattleState {
  id: string;
  status: 'pending' | 'running' | 'completed';
  turn: number;
  maxTurns: number;
  processes: ProcessId[];
  winner: ProcessId | null;
  startTime: number;
  endTime: number | null;
  scores: Map<ProcessId, number>;
}

export interface BattleOptions {
  maxTurns: number;
  maxCyclesPerTurn: number;
  maxMemoryPerProcess: number;
}

export class BattleController {
  private state: BattleState;
  private processManager: ProcessManager;
  private options: BattleOptions;

  constructor(processManager: ProcessManager, options: BattleOptions) {
    this.processManager = processManager;
    this.options = options;
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
      scores: new Map()
    };
  }

  addProcess(processId: ProcessId): void {
    if (this.state.status !== 'pending') {
      throw new Error('Cannot add processes after battle has started');
    }

    const process = this.processManager.getProcess(processId);
    this.validateProcess(process);

    this.state.processes.push(processId);
    this.state.scores.set(processId, 0);
  }

  start(): void {
    if (this.state.processes.length < 2) {
      throw new Error('At least two processes are required for a battle');
    }

    this.state.status = 'running';
    this.state.startTime = Date.now();
  }

  nextTurn(): boolean {
    if (this.state.status !== 'running') {
      throw new Error('Battle is not running');
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

      // Update score and cycles
      const currentScore = this.state.scores.get(runningProcess) || 0;
      this.state.scores.set(runningProcess, currentScore + 1);
      cyclesThisTurn++;
      processesRun.add(runningProcess);

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
}