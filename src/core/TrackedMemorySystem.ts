import { MemorySystem } from './MemorySystem';
import { ITrackedMemorySystem, ProcessId } from './IMemorySystem';

export class TrackedMemorySystem extends MemorySystem implements ITrackedMemorySystem {
  private readonly owners: Uint16Array;
  private currentPid: ProcessId | null = null;

  constructor(size: number = 65536) {
    super(size);
    this.owners = new Uint16Array(this.size);
  }

  setCurrentProcess(pid: ProcessId | null): void {
    this.currentPid = pid;
  }

  /**
   * Overrides MemorySystem.write to update the ownership map.
   */
  override write(address: number, value: number): void {
    const addr = this.normalizeAddress(address);
    
    // Check protection before updating ownership, because a protected write
    // is a no-op and should not change the owner.
    if (this.isProtected(addr)) {
      super.write(address, value);
      return;
    }

    if (this.currentPid !== null) {
      this.owners[addr] = this.currentPid;
    }

    super.write(address, value);
  }

  getOwner(address: number): ProcessId {
    const addr = this.normalizeAddress(address);
    return this.owners[addr];
  }

  getOwners(): Uint16Array {
    return new Uint16Array(this.owners);
  }

  setOwnershipRange(start: number, size: number, owner: ProcessId): void {
    for (let i = 0; i < size; i++) {
      const addr = this.normalizeAddress(start + i);
      this.owners[addr] = owner;
    }
  }
}
