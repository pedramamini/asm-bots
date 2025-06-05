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
} from './types.js';

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
        state: ProcessState.Ready,
        currentInstruction: ''
      }
    };

    // Validate resource limits if provided
    if (options.resourceLimits) {
      this.validateResourceLimits(process, options.resourceLimits);
    }

    this.processes.set(processId, process);
    return processId;
  }

  reset(processId: ProcessId): void {
    const process = this.getProcess(processId);

    // Reset process state
    process.context.state = ProcessState.Ready;
    process.context.cycles = 0;
    process.cyclesUsed = 0;
    process.lastRun = 0;

    // Reset registers
    process.context.registers = {
      r0: 0,
      r1: 0,
      r2: 0,
      r3: 0,
      sp: 0xFFFF,
      pc: process.context.memory[0]?.start || 0, // Reset to entry point using start property
      flags: 0
    };

    // Reset current instruction
    process.context.currentInstruction = '';

    if (this.runningProcess === processId) {
      this.runningProcess = null;
    }
  }

  terminate(processId: ProcessId, reason?: string): void {
    const process = this.getProcess(processId);
    process.context.state = ProcessState.Terminated;
    process.lastRun = Date.now(); // Record termination time for winner determination

    if (this.runningProcess === processId) {
      this.runningProcess = null;
    }

    // Log termination reason if provided
    if (reason) {
      console.log(`Process ${processId} (${process.name}) terminated: ${reason}`);
    }

    // Clean up resources
    this.releaseResources(process);
  }

  schedule(): ProcessId | null {
    // Debug output - current process state
    console.log("\nProcess State Before Scheduling:");
    for (const [pid, process] of this.processes.entries()) {
      console.log(`- Process ${pid} (${process.name}): State=${process.context.state}, Cycles=${process.context.cycles}/${process.quantum}`);
    }
    
    // If there's a running process, handle its cycle
    if (this.runningProcess !== null) {
      const runningProcess = this.processes.get(this.runningProcess)!;

      // First increment cycles
      runningProcess.context.cycles++;
      runningProcess.cyclesUsed++;

      // Check if quantum has expired
      if (runningProcess.context.cycles >= runningProcess.quantum) {
        console.log(`Process ${this.runningProcess} quantum expired (${runningProcess.context.cycles}/${runningProcess.quantum})`);
        
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

  // Track the last scheduled process ID to implement round-robin
  private lastScheduledId: ProcessId | null = null;
  
  private findNextProcess(): ProcessId | null {
    // If there are no processes, return null
    if (this.processes.size === 0) {
      return null;
    }
    
    // If round-robin is disabled, use the original priority-based scheduling
    if (this.schedulerOptions.roundRobin === false) {
      // Just find the highest priority ready process
      let nextProcess: Process | null = null;
      let highestPriority = -1;
      
      for (const process of this.processes.values()) {
        if (process.context.state === ProcessState.Ready && process.priority > highestPriority) {
          nextProcess = process;
          highestPriority = process.priority;
        }
      }
      
      return nextProcess?.id ?? null;
    }
    
    // Below is the round-robin implementation
    // Track highest priority
    let highestPriority = -1;
    // Map of processes by priority
    const readyProcessesByPriority = new Map<number, ProcessId[]>();
    
    // Debug output - log all processes and their states
    console.log("\nDebug Scheduling:");
    console.log("All Processes:");
    for (const [pid, process] of this.processes.entries()) {
      console.log(`- Process ${pid} (${process.name}): Priority=${process.priority}, State=${process.context.state}`);
    }
    
    // Group processes by priority
    for (const process of this.processes.values()) {
      if (process.context.state === ProcessState.Ready) {
        if (!readyProcessesByPriority.has(process.priority)) {
          readyProcessesByPriority.set(process.priority, []);
        }
        readyProcessesByPriority.get(process.priority)!.push(process.id);
        
        // Track highest priority
        if (process.priority > highestPriority) {
          highestPriority = process.priority;
        }
      }
    }
    
    // If no ready processes, return null
    if (highestPriority === -1) {
      return null;
    }
    
    // Get ready processes at highest priority
    const highestPriorityProcesses = readyProcessesByPriority.get(highestPriority)!;
    
    // If there's only one process at highest priority, return it
    if (highestPriorityProcesses.length === 1) {
      this.lastScheduledId = highestPriorityProcesses[0];
      console.log(`Scheduling: Only one process available - Bot ${this.lastScheduledId}`);
      return this.lastScheduledId;
    }
    
    // Implement round-robin for processes at the same priority level
    // Additional debug output
    console.log("Round-Robin Details:");
    console.log(`- Highest priority processes: ${JSON.stringify(highestPriorityProcesses)}`);
    console.log(`- Last scheduled ID: ${this.lastScheduledId}`);
    
    // Fixed round-robin algorithm:
    // If no last ID, start with first process
    if (this.lastScheduledId === null) {
      this.lastScheduledId = highestPriorityProcesses[0];
      console.log(`Scheduling: Bot ${this.lastScheduledId} selected from ${highestPriorityProcesses.length} ready processes (first run)`);
      return this.lastScheduledId;
    }
    
    // If last scheduled process is in the list, pick the next one
    const currentIndex = highestPriorityProcesses.indexOf(this.lastScheduledId);
    if (currentIndex !== -1) {
      // Get the next process in the list, wrapping around to the beginning
      const nextIndex = (currentIndex + 1) % highestPriorityProcesses.length;
      this.lastScheduledId = highestPriorityProcesses[nextIndex];
      console.log(`Scheduling: Bot ${this.lastScheduledId} selected from ${highestPriorityProcesses.length} ready processes (rotating from ${currentIndex} to ${nextIndex})`);
      return this.lastScheduledId;
    }
    
    // The last scheduled process is no longer in the list
    // Just pick the first available process and start a new round-robin cycle
    this.lastScheduledId = highestPriorityProcesses[0];
    console.log(`Scheduling: Bot ${this.lastScheduledId} selected from ${highestPriorityProcesses.length} ready processes (previous process no longer available)`);
    return this.lastScheduledId;
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

    // Clear current instruction
    process.context.currentInstruction = '';
  }
}