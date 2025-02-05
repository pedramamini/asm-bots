import { ProcessManager } from './ProcessManager';
import { ProcessState, ProcessCreateOptions } from './types';

describe('ProcessManager', () => {
  let manager: ProcessManager;

  const defaultOptions = {
    defaultQuantum: 10,
    defaultPriority: 1,
    maxProcesses: 10
  };

  const defaultProcessOptions: ProcessCreateOptions = {
    name: 'test-process',
    owner: 'test-owner',
    memorySegments: [{ name: 'code', start: 0, size: 100, data: [] }],
    entryPoint: 0
  };

  beforeEach(() => {
    manager = new ProcessManager(defaultOptions);
  });

  describe('create()', () => {
    it('initializes process state correctly', () => {
      const processId = manager.create(defaultProcessOptions);
      const process = manager.getProcess(processId);

      expect(process).toBeDefined();
      expect(process.name).toBe('test-process');
      expect(process.owner).toBe('test-owner');
      expect(process.context.state).toBe(ProcessState.Ready);
      expect(process.context.registers.pc).toBe(0);
      expect(process.priority).toBe(defaultOptions.defaultPriority);
      expect(process.quantum).toBe(defaultOptions.defaultQuantum);
    });

    it('enforces maximum process limit', () => {
      // Create maximum number of processes
      for (let i = 0; i < defaultOptions.maxProcesses; i++) {
        manager.create({ ...defaultProcessOptions, name: `process-${i}` });
      }

      // Attempt to create one more process
      expect(() => manager.create(defaultProcessOptions))
        .toThrow('Maximum number of processes reached');
    });
  });

  describe('schedule()', () => {
    it('maintains fairness in process scheduling', () => {
      // Create three processes with different priorities
      const processIds = [
        manager.create({
          ...defaultProcessOptions,
          name: 'high-priority',
          priority: 3,
          quantum: 2 // Small quantum for testing
        }),
        manager.create({
          ...defaultProcessOptions,
          name: 'medium-priority',
          priority: 2,
          quantum: 2
        }),
        manager.create({
          ...defaultProcessOptions,
          name: 'low-priority',
          priority: 1,
          quantum: 2
        })
      ];

      // Initial state verification
      const initialHigh = manager.getProcess(processIds[0]);
      const initialMed = manager.getProcess(processIds[1]);
      const initialLow = manager.getProcess(processIds[2]);

      console.log('Initial states:', {
        high: { state: initialHigh.context.state, cycles: initialHigh.context.cycles },
        med: { state: initialMed.context.state, cycles: initialMed.context.cycles },
        low: { state: initialLow.context.state, cycles: initialLow.context.cycles }
      });

      expect(initialHigh.context.state).toBe(ProcessState.Ready);
      expect(initialMed.context.state).toBe(ProcessState.Ready);
      expect(initialLow.context.state).toBe(ProcessState.Ready);

      // First schedule should pick highest priority
      const first = manager.schedule();
      console.log('After first schedule:', {
        selected: first,
        expected: processIds[0],
        high: manager.getProcess(processIds[0]).context.state
      });
      expect(first).toBe(processIds[0]);
      expect(manager.getProcess(processIds[0]).context.state).toBe(ProcessState.Running);

      // Run high priority process for one cycle
      const cycle1 = manager.schedule(); // cycle 1
      const afterOneCycle = manager.getProcess(processIds[0]);
      console.log('After cycle 1:', {
        selected: cycle1,
        cycles: afterOneCycle.context.cycles,
        cyclesUsed: afterOneCycle.cyclesUsed,
        state: afterOneCycle.context.state
      });
      expect(afterOneCycle.context.cycles).toBe(1);
      expect(afterOneCycle.cyclesUsed).toBe(1);
      expect(afterOneCycle.context.state).toBe(ProcessState.Running);

      // Run high priority process for second cycle (quantum expires)
      const cycle2 = manager.schedule(); // cycle 2
      const afterTwoCycles = manager.getProcess(processIds[0]);
      console.log('After cycle 2:', {
        selected: cycle2,
        cycles: afterTwoCycles.context.cycles,
        cyclesUsed: afterTwoCycles.cyclesUsed,
        state: afterTwoCycles.context.state
      });
      expect(afterTwoCycles.context.cycles).toBe(0); // Reset after quantum expired
      expect(afterTwoCycles.cyclesUsed).toBe(2);
      expect(afterTwoCycles.context.state).toBe(ProcessState.Ready);

      // Next schedule should pick medium priority
      const second = manager.schedule();
      console.log('After medium priority schedule:', {
        selected: second,
        expected: processIds[1],
        states: {
          high: manager.getProcess(processIds[0]).context.state,
          med: manager.getProcess(processIds[1]).context.state,
          low: manager.getProcess(processIds[2]).context.state
        }
      });
      expect(second).toBe(processIds[1]);

      // Verify final states
      const finalHigh = manager.getProcess(processIds[0]);
      const finalMed = manager.getProcess(processIds[1]);
      const finalLow = manager.getProcess(processIds[2]);

      console.log('Final states:', {
        high: { state: finalHigh.context.state, cyclesUsed: finalHigh.cyclesUsed },
        med: { state: finalMed.context.state, cyclesUsed: finalMed.cyclesUsed },
        low: { state: finalLow.context.state, cyclesUsed: finalLow.cyclesUsed }
      });

      expect(finalHigh.context.state).toBe(ProcessState.Ready);
      expect(finalMed.context.state).toBe(ProcessState.Running);
      expect(finalLow.context.state).toBe(ProcessState.Ready);

      expect(finalHigh.cyclesUsed).toBe(2); // Used full quantum
      expect(finalMed.cyclesUsed).toBe(0); // Just started
      expect(finalLow.cyclesUsed).toBe(0); // Never ran
    });

    it('handles empty process queue', () => {
      expect(manager.schedule()).toBeNull();
    });
  });

  describe('terminate()', () => {
    it('cleans up resources properly', () => {
      const processId = manager.create(defaultProcessOptions);

      // Verify initial state
      const beforeTerminate = manager.getProcess(processId);
      expect(beforeTerminate.context.state).toBe(ProcessState.Ready);
      expect(beforeTerminate.memoryUsed).toBe(100);
      expect(beforeTerminate.context.memory.length).toBe(1);

      // Terminate the process
      manager.terminate(processId);

      // Verify cleanup
      const afterTerminate = manager.getProcess(processId);
      expect(afterTerminate.context.state).toBe(ProcessState.Terminated);
      expect(afterTerminate.memoryUsed).toBe(0);
      expect(afterTerminate.context.memory).toHaveLength(0);
      expect(afterTerminate.context.registers.pc).toBe(0);
    });

    it('handles termination of running process', () => {
      const processId = manager.create(defaultProcessOptions);

      // Schedule the process
      manager.schedule();
      expect(manager.getRunningProcess()).toBe(processId);

      // Terminate it
      manager.terminate(processId);
      expect(manager.getRunningProcess()).toBeNull();
    });
  });

  describe('getStats()', () => {
    it('provides accurate scheduler statistics', () => {
      // Create processes in different states
      const runningId = manager.create({
        ...defaultProcessOptions,
        name: 'running-process'
      });

      const readyId = manager.create({
        ...defaultProcessOptions,
        name: 'ready-process'
      });

      // Schedule one process to running
      manager.schedule();

      // Terminate one process
      manager.terminate(readyId);

      const stats = manager.getStats();
      expect(stats.totalProcesses).toBe(2);
      expect(stats.runningProcess).toBe(runningId);
      expect(stats.readyProcesses).toBe(0);
      expect(stats.terminatedProcesses).toBe(1);
    });
  });
});