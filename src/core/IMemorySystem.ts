/**
 * @file IMemorySystem.ts
 * @description TypeScript interface definitions for the Memory System.
 */

export type ProcessId = number;

export interface IMemorySystem {
  /**
   * Reads a byte from the specified address.
   * Normalizes addresses via circular wrapping.
   * @returns The byte value (0-255).
   */
  read(address: number): number;

  /**
   * Writes a byte to the specified address.
   * Normalizes addresses via circular wrapping.
   * Throws/Logs if the address is protected.
   */
  write(address: number, value: number): void;

  /**
   * Marks an address as protected from writes.
   */
  protect(address: number): void;

  /**
   * Removes protection from an address.
   */
  unprotect(address: number): void;

  /**
   * Checks if an address is currently protected.
   */
  isProtected(address: number): boolean;

  /**
   * Returns a copy of the current memory state.
   */
  getMemory(): Uint8Array;
}

export interface ITrackedMemorySystem extends IMemorySystem {
  /**
   * Sets the PID of the process currently performing memory operations.
   * Used to automatically update the ownership map on writes.
   */
  setCurrentProcess(pid: ProcessId | null): void;

  /**
   * Retrieves the owner of the cell at the given address.
   * @returns The PID of the owner, or 0 if unowned.
   */
  getOwner(address: number): ProcessId;

  /**
   * Returns a copy of the ownership map.
   */
  getOwners(): Uint16Array;

  /**
   * Sets ownership for a range of cells. Typically used during bot loading.
   */
  setOwnershipRange(start: number, size: number, owner: ProcessId): void;
}
