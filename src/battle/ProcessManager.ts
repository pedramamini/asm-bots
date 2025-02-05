import {
  Process,
  ProcessId,
  ProcessState,
  ProcessContext,
  ProcessCreateOptions,
  SchedulerOptions,
  SchedulerStats,
  ResourceUsage,
  ResourceLimits
} from './types';

export class ProcessManager {
  private processes: Map<ProcessId, Process>;
  private nextProcessId: ProcessId;
  private runningProcess: ProcessId | null;
  private schedulerOptions: SchedulerOptions;
  private startTime: number;

  constructor(options: SchedulerOptions) {
    this.processes = new Map();
    this.nextProcessId = 1;
    this.runningProcess = null;
    this.schedulerOptions = options;
    this.startTime = Date.now();
  }

  create(options: ProcessCreateOptions): ProcessId {
    if (this.processes.size >= this.schedulerOptions.maxProcesses) {
      throw new Error('Maximum number of processes reached');
    }

    const processId = this.nextProcessId++;
    const process: Process = {
      id: processId,
      name: options.name,
      owner: options.owner,
      priority: options.priority ?? this.schedulerOptions.defaultPriority,
      quantum: options.quantum ?? this.schedulerOptions.defaultQuantum,
      cyclesUsed: 0,
      memoryUsed: this.calculateMemoryUsage(options.memorySegments),
      createdAt: Date.now(),
      lastRun: 0,
      context: {
        registers: {
          r0: 0,
          r1: 0,
          r2: 0,
          r3: 0,
          sp: 0xFFFF, // Stack starts at top of memory
          pc: options.entryPoint,
          flags: 0
        },
        memory: options.memorySegments,
        cycles: 0,
        state: ProcessState.Ready
      }
    };

    // Validate resource limits if provided
    if (options.resourceLimits) {
      this.validateResourceLimits(process, options.resourceLimits);
    }

    this.processes.set(processId, process);
    return processId;
  }

  terminate(processId: ProcessId, reason?: string): void {
    const process = this.getProcess(processId);
    process.context.state = ProcessState.Terminated;

    if (this.runningProcess === processId) {
      this.runningProcess = null;
    }

    // Clean up resources
    this.releaseResources(process);
  }

  schedule(): ProcessId | null {
    // If there's a running process, handle its cycle
    if (this.runningProcess !== null) {
      const runningProcess = this.processes.get(this.runningProcess)!;

      // First increment cycles
      runningProcess.context.cycles++;
      runningProcess.cyclesUsed++;

      // Check if quantum has expired
      if (runningProcess.context.cycles >= runningProcess.quantum) {
        // Move to ready state and clear running process
        runningProcess.context.state = ProcessState.Ready;
        runningProcess.context.cycles = 0;
        this.runningProcess = null;

        // Find and schedule next process
        const nextProcessId = this.findNextProcess();
        if (nextProcessId !== null) {
          const nextProcess = this.processes.get(nextProcessId)!;
          nextProcess.context.state = ProcessState.Running;
          nextProcess.lastRun = Date.now();
          nextProcess.context.cycles = 0;
          this.runningProcess = nextProcessId;
        }
        return this.runningProcess;
      }

      return this.runningProcess;
    }

    // No running process, find and schedule next one
    const nextProcessId = this.findNextProcess();
    if (nextProcessId !== null) {
      const nextProcess = this.processes.get(nextProcessId)!;
      nextProcess.context.state = ProcessState.Running;
      nextProcess.lastRun = Date.now();
      nextProcess.context.cycles = 0;
      this.runningProcess = nextProcessId;
    }

    return this.runningProcess;
  }

  private findNextProcess(): ProcessId | null {
    let nextProcess: Process | null = null;
    let highestPriority = -1;

    // Find highest priority ready process
    for (const process of this.processes.values()) {
      if (process.context.state === ProcessState.Ready && process.priority > highestPriority) {
        nextProcess = process;
        highestPriority = process.priority;
      }
    }

    return nextProcess?.id ?? null;
  }

  getStats(): SchedulerStats {
    let ready = 0;
    let blocked = 0;
    let terminated = 0;
    let totalCycles = 0;
    let totalWaitTime = 0;

    for (const process of this.processes.values()) {
      switch (process.context.state) {
        case ProcessState.Ready:
          ready++;
          totalWaitTime += Date.now() - process.lastRun;
          break;
        case ProcessState.Blocked:
          blocked++;
          break;
        case ProcessState.Terminated:
          terminated++;
          break;
      }
      totalCycles += process.cyclesUsed;
    }

    return {
      totalProcesses: this.processes.size,
      runningProcess: this.runningProcess,
      readyProcesses: ready,
      blockedProcesses: blocked,
      terminatedProcesses: terminated,
      totalCyclesExecuted: totalCycles,
      averageWaitTime: ready > 0 ? totalWaitTime / ready : 0
    };
  }

  getResourceUsage(processId: ProcessId): ResourceUsage {
    const process = this.getProcess(processId);
    return {
      memory: process.memoryUsed,
      cycles: process.cyclesUsed,
      instructions: process.context.cycles
    };
  }

  getProcess(processId: ProcessId): Process {
    const process = this.processes.get(processId);
    if (!process) {
      throw new Error(`Process ${processId} not found`);
    }
    return process;
  }

  getProcessCount(): number {
    return this.processes.size;
  }

  getRunningProcess(): ProcessId | null {
    return this.runningProcess;
  }

  private calculateMemoryUsage(segments: ProcessContext['memory']): number {
    return segments.reduce((total, segment) => total + segment.size, 0);
  }

  private validateResourceLimits(process: Process, limits: ResourceLimits): void {
    if (limits.maxMemory && process.memoryUsed > limits.maxMemory) {
      throw new Error(`Memory usage exceeds limit: ${process.memoryUsed} > ${limits.maxMemory}`);
    }
  }

  private releaseResources(process: Process): void {
    // Mark memory segments as free
    process.context.memory = [];
    process.memoryUsed = 0;

    // Reset registers
    Object.keys(process.context.registers).forEach(reg => {
      (process.context.registers as any)[reg] = 0;
    });
  }
}