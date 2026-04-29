import { describe, it, expect } from 'vitest';
import { BattleSystem } from '../battle-system';

describe('DAT Termination', () => {
  it('should immediately terminate a process when it executes a DAT byte (0xF0)', () => {
    const system = new BattleSystem();
    
    const p1 = system.processes.createProcess({
      name: 'Bot1',
      owner: 'Owner1',
      priority: 1,
      quantum: 5,
      memorySegments: [],
      pc: 100,
    });

    if (!p1) throw new Error('Failed to create process');

    // Place a DAT bomb (0xF0) at address 100
    system.memory.write(100, 0xF0);

    // Execute instruction for p1
    const result = system.executeInstruction(p1.id);

    expect(result).toBe(false);
    expect(system.processes.getProcess(p1.id)?.context.state).toBe('Terminated');
  });

  it('should not terminate a process when it executes a non-DAT byte', () => {
    const system = new BattleSystem();
    
    const p1 = system.processes.createProcess({
      name: 'Bot1',
      owner: 'Owner1',
      priority: 1,
      quantum: 5,
      memorySegments: [],
      pc: 100,
    });

    if (!p1) throw new Error('Failed to create process');

    // Place a normal byte (e.g., 0x00) at address 100
    system.memory.write(100, 0x00);

    // Execute instruction for p1
    const result = system.executeInstruction(p1.id);

    expect(result).toBe(true);
    expect(system.processes.getProcess(p1.id)?.context.state).toBe('Ready');
  });
});
