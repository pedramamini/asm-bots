import { BattleController, BattleOptions } from './BattleController.js';
import { ProcessManager } from './ProcessManager.js';
import { ProcessCreateOptions, ProcessState } from './types.js';

describe('BattleController', () => {
  let controller: BattleController;
  let processManager: ProcessManager;

  const defaultBattleOptions: BattleOptions = {
    maxTurns: 100,
    maxCyclesPerTurn: 10,
    maxMemoryPerProcess: 1000
  };

  const defaultProcessOptions: ProcessCreateOptions = {
    name: 'test-process',
    owner: 'test-owner',
    memorySegments: [{ name: 'code', start: 0, size: 100, data: new Uint8Array(100) }],
    entryPoint: 0,
    quantum: 2 // Small quantum for testing
  };

  beforeEach(() => {
    processManager = new ProcessManager({
      defaultQuantum: 10,
      defaultPriority: 1,
      maxProcesses: 10
    });
    controller = new BattleController(processManager, defaultBattleOptions);
  });

  describe('nextTurn()', () => {
    it('updates game state correctly', () => {
      // Create two processes
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      // Add processes to battle
      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      // Execute one turn
      const result = controller.nextTurn();
      expect(result).toBe(true);

      // Verify state updates
      const state = controller.getState();
      expect(state.turn).toBe(1);
      expect(state.status).toBe('running');

      // Verify processes executed
      const p1 = processManager.getProcess(process1);
      const p2 = processManager.getProcess(process2);
      expect(p1.cyclesUsed).toBeGreaterThan(0);
      expect(p2.cyclesUsed).toBeGreaterThan(0);

      // Verify scores were updated
      expect(state.scores.get(process1)).toBeGreaterThan(0);
      expect(state.scores.get(process2)).toBeGreaterThan(0);
    });

    it('enforces max turns limit', () => {
      // Create and add processes
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      // Run for max turns
      for (let i = 0; i < defaultBattleOptions.maxTurns; i++) {
        const hasNext = controller.nextTurn();
        if (i === defaultBattleOptions.maxTurns - 1) {
          expect(hasNext).toBe(false);
        }
      }

      const state = controller.getState();
      expect(state.status).toBe('completed');
      expect(state.turn).toBe(defaultBattleOptions.maxTurns);
      expect(state.endTime).not.toBeNull();
    });
  });

  describe('checkVictory()', () => {
    it('identifies winners when one process remains', () => {
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      // Terminate one process
      processManager.terminate(process2);

      expect(controller.checkVictory()).toBe(true);

      const state = controller.getState();
      expect(state.winner).toBe(process1);
    });

    it('determines winner by score when all processes terminated', () => {
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      // Execute some turns to accumulate scores
      controller.nextTurn();
      controller.nextTurn();

      // Terminate both processes
      processManager.terminate(process1);
      processManager.terminate(process2);

      expect(controller.checkVictory()).toBe(true);
      const state = controller.getState();
      expect(state.winner).not.toBeNull();
      expect(state.scores.get(state.winner!)).toBeGreaterThan(0);
    });
  });

  describe('saveState() and loadState()', () => {
    it('preserves all battle data', () => {
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      // Execute some turns
      controller.nextTurn();
      controller.nextTurn();

      // Save the state
      const savedState = controller.saveState();

      // Create new controller and load state
      const newController = new BattleController(processManager, defaultBattleOptions);
      newController.loadState(savedState);

      // Compare states
      const originalState = controller.getState();
      const loadedState = newController.getState();

      expect(loadedState.id).toBe(originalState.id);
      expect(loadedState.turn).toBe(originalState.turn);
      expect(loadedState.status).toBe(originalState.status);
      expect(loadedState.processes).toEqual(originalState.processes);
      expect(loadedState.winner).toBe(originalState.winner);
      expect(Array.from(loadedState.scores.entries())).toEqual(Array.from(originalState.scores.entries()));
    });
  });

  describe('battle initialization', () => {
    it('requires minimum two processes', () => {
      const process1 = processManager.create(defaultProcessOptions);
      controller.addProcess(process1);

      expect(() => controller.start()).toThrow('At least two processes are required');
    });

    it('prevents adding processes after battle starts', () => {
      const process1 = processManager.create(defaultProcessOptions);
      const process2 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-2'
      });

      controller.addProcess(process1);
      controller.addProcess(process2);
      controller.start();

      const process3 = processManager.create({
        ...defaultProcessOptions,
        name: 'test-process-3'
      });

      expect(() => controller.addProcess(process3))
        .toThrow('Cannot add processes after battle has started');
    });

    it('enforces memory limits for processes', () => {
      const largeProcess = processManager.create({
        ...defaultProcessOptions,
        memorySegments: [{ name: 'code', start: 0, size: 2000, data: new Uint8Array(2000) }]
      });

      expect(() => controller.addProcess(largeProcess))
        .toThrow('exceeds maximum memory limit');
    });
  });
});