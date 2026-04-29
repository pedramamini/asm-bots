/**
 * @file battle-system.ts
 * @description Orchestrator that ties together memory, processes, and the scheduler.
 */

import { 
  ProcessManager, 
  CreateProcessParams 
} from './process-manager';
import { Scheduler } from './scheduler';
import { 
  BattleController, 
  BattleOptions, 
  BattleControllerConfig 
} from './battle-controller';
import { TrackedMemorySystem } from './TrackedMemorySystem';
import { ProcessId, Process } from './process';

export class BattleSystem {
  public readonly memory: TrackedMemorySystem;
  public readonly processes: ProcessManager;
  public readonly scheduler: Scheduler;
  public readonly controller: BattleController;

  constructor(options: BattleOptions = {
    maxTurns: 1000,
    maxCyclesPerTurn: 100,
    maxMemoryPerProcess: 4096,
    maxLogEntries: 1000,
    memorySize: 65536,
    roundRobin: true,
  }) {
    this.memory = new TrackedMemorySystem(options.memorySize || 65536);
    this.processes = new ProcessManager();
    this.scheduler = new Scheduler();

    const config: BattleControllerConfig = {
      options,
      onBeforeExecution: (pid) => this.executeInstruction(pid),
      onAfterExecution: (pid) => {
        // Hook for post-execution logic (e.g. logging)
      },
      scheduleNext: () => {
        const next = this.scheduler.schedule(this.processes.getActiveProcesses());
        return next ? next.id : null;
      },
      checkVictory: () => this.checkVictory(),
      endBattle: () => this.endBattle(),
    };

    this.controller = new BattleController(config);
  }

  executeInstruction(pid: ProcessId): boolean {
    const process = this.processes.getProcess(pid);
    if (!process || process.context.state === 'Terminated') return false;

    // 1. Set current process for memory ownership tracking
    this.memory.setCurrentProcess(pid);

    // 2. Read opcode at current PC
    const pc = process.context.registers.pc;
    const opcode = this.memory.read(pc);

    // 3. Handle termination for DAT (0xF0)
    // Executing a DAT byte terminates the process immediately.
    if (opcode === 0xF0) {
      this.processes.terminateProcess(pid);
      return false;
    }

    // For now, we prioritize the integration of the Scheduler and ProcessManager.
    // We simulate an instruction execution by advancing cycles and potentially 
    // letting the scheduler handle preemption in the next tick.
    return true;
  }

  checkVictory(): { winner: ProcessId | null; reason: string | null } {
    const active = this.processes.getActiveProcesses();
    
    if (active.length === 0) {
      return { winner: null, reason: 'no_processes' };
    }

    if (active.length === 1) {
      return { winner: active[0].id, reason: 'last_standing' };
    }
    
    return { winner: null, reason: null };

  }

  endBattle(): void {
    this.controller.status = 'completed';
    // Terminate all remaining processes
    this.processes.getAllProcesses().forEach(p => {
      this.processes.terminateProcess(p.id);
    });
  }

  runBattle(maxTurns?: number): void {
    if (maxTurns) {
      // Override maxTurns in options if provided
      this.controller.options.maxTurns = maxTurns;
    }

    this.controller.start();
    while (this.controller.status === 'running') {
      if (!this.controller.nextTurn()) {
        break;
      }
    }
  }
}
