/**
 * Memory System with Ownership Tracking
 * Extends the basic memory system to track which process owns each memory location
 */

import { MemorySystem } from './MemorySystem.js';
import { ProcessId } from '../battle/types.js';

export class TrackedMemorySystem extends MemorySystem {
  private owners: Uint16Array;
  private currentOwner: ProcessId | null = null;

  constructor(size?: number) {
    super(size);
    // Track owner for each memory location (0 = unowned)
    this.owners = new Uint16Array(size || 65536);
  }

  /**
   * Set the current process that is executing (for ownership tracking)
   */
  public setCurrentProcess(processId: ProcessId | null): void {
    this.currentOwner = processId;
  }

  /**
   * Override write to track ownership
   */
  public write(address: number, value: number): void {
    super.write(address, value);
    
    // Track ownership if we have a current process
    if (this.currentOwner !== null) {
      const normalizedAddress = ((address % this['SIZE']) + this['SIZE']) % this['SIZE'];
      this.owners[normalizedAddress] = this.currentOwner;
    }
  }

  /**
   * Get the owner of a memory location
   */
  public getOwner(address: number): ProcessId {
    const normalizedAddress = ((address % this['SIZE']) + this['SIZE']) % this['SIZE'];
    return this.owners[normalizedAddress];
  }

  /**
   * Get all owners for visualization
   */
  public getOwners(): Uint16Array {
    return new Uint16Array(this.owners);
  }

  /**
   * Clear ownership when freeing memory
   */
  public free(address: number): void {
    super.free(address);
    const normalizedAddress = ((address % this['SIZE']) + this['SIZE']) % this['SIZE'];
    // Clear ownership for the freed region
    const size = this['allocatedRegions'].get(normalizedAddress);
    if (size) {
      for (let i = 0; i < size; i++) {
        this.owners[(normalizedAddress + i) % this['SIZE']] = 0;
      }
    }
  }

  /**
   * Set initial ownership for loaded code
   */
  public setOwnershipRange(start: number, size: number, owner: ProcessId): void {
    for (let i = 0; i < size; i++) {
      const address = (start + i) % this['SIZE'];
      this.owners[address] = owner;
    }
  }
}