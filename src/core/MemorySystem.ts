import { IMemorySystem } from './IMemorySystem';

export class MemorySystem implements IMemorySystem {
  protected readonly size: number;
  protected readonly buffer: Uint8Array;
  protected readonly protectedAddresses: Set<number> = new Set();

  constructor(size: number = 65536) {
    this.size = size;
    this.buffer = new Uint8Array(this.size);
  }

  /**
   * Normalizes the address using circular wrapping: ((addr % SIZE) + SIZE) % SIZE
   */
  protected normalizeAddress(address: number): number {
    return ((address % this.size) + this.size) % this.size;
  }

  read(address: number): number {
    const addr = this.normalizeAddress(address);
    return this.buffer[addr];
  }

  write(address: number, value: number): void {
    const addr = this.normalizeAddress(address);
    
    if (this.isProtected(addr)) {
      console.warn(`Memory violation: Attempted write to protected address ${addr}`);
      return;
    }

    this.buffer[addr] = value & 0xFF;
  }

  protect(address: number): void {
    this.protectedAddresses.add(this.normalizeAddress(address));
  }

  unprotect(address: number): void {
    this.protectedAddresses.delete(this.normalizeAddress(address));
  }

  isProtected(address: number): boolean {
    return this.protectedAddresses.has(this.normalizeAddress(address));
  }

  getMemory(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}
