/**
 * Core Wars Memory System Implementation
 * 16-bit addressable memory with circular addressing and protection
 */
export interface AccessViolation {
    type: 'protection' | 'bounds' | 'allocation';
    address: number;
    operation: 'read' | 'write' | 'allocate';
    timestamp: Date;
    message: string;
}

export class MemorySystem {
    private memory: Uint8Array;
    private protectedRegions: Set<number>;
    private allocatedRegions: Map<number, number>; // start -> size
    private accessLog: AccessViolation[];
    private readonly SIZE: number;

    constructor(size?: number) {
        // Allow customizing memory size, default to 64KB
        this.SIZE = size || 65536; 
        console.log(`Initializing memory system with ${this.SIZE} bytes`);
        
        this.memory = new Uint8Array(this.SIZE);
        this.protectedRegions = new Set();
        this.allocatedRegions = new Map();
        this.accessLog = [];
    }

    /**
     * Allocate a contiguous block of memory
     * @param size number of bytes to allocate
     * @returns starting address of allocated block
     * @throws Error if unable to allocate requested size
     */
    public allocate(size: number): number {
        if (size <= 0 || size > this.SIZE) {
            this.logViolation({
                type: 'allocation',
                address: 0,
                operation: 'allocate',
                timestamp: new Date(),
                message: `Invalid allocation size: ${size}`
            });
            throw new Error(`Invalid allocation size: ${size}`);
        }

        // Simple first-fit allocation strategy
        let start = 0;
        while (start < this.SIZE) {
            if (this.isRegionFree(start, size)) {
                this.allocatedRegions.set(start, size);
                return start;
            }
            start += this.findNextAllocationBoundary(start);
        }

        this.logViolation({
            type: 'allocation',
            address: 0,
            operation: 'allocate',
            timestamp: new Date(),
            message: `Failed to allocate ${size} bytes: no contiguous space available`
        });
        throw new Error(`Failed to allocate ${size} bytes: no contiguous space available`);
    }

    /**
     * Free an allocated memory region
     * @param address starting address of region to free
     */
    public free(address: number): void {
        const normalizedAddress = this.normalizeAddress(address);
        if (!this.allocatedRegions.has(normalizedAddress)) {
            throw new Error(`Invalid free address: 0x${normalizedAddress.toString(16)}`);
        }
        this.allocatedRegions.delete(normalizedAddress);
    }

    /**
     * Read a byte from memory with bounds checking and access logging
     * @param address 16-bit address
     * @returns byte value at address
     * @throws Error if address is out of bounds
     */
    public read(address: number): number {
        const normalizedAddress = this.normalizeAddress(address);
        return this.memory[normalizedAddress];
    }

    /**
     * Write a byte to memory with protection checking
     * @param address 16-bit address
     * @param value byte to write
     * @throws Error if address is protected
     */
    public write(address: number, value: number): void {
        const normalizedAddress = this.normalizeAddress(address);

        if (this.isProtected(normalizedAddress)) {
            this.logViolation({
                type: 'protection',
                address: normalizedAddress,
                operation: 'write',
                timestamp: new Date(),
                message: `Memory protection violation at address 0x${normalizedAddress.toString(16)}`
            });
            throw new Error(`Memory protection violation at address 0x${normalizedAddress.toString(16)}`);
        }

        this.memory[normalizedAddress] = value & 0xFF;
    }

    /**
     * Protect a region of memory from writes
     * @param address 16-bit address to protect
     */
    public protect(address: number): void {
        const normalizedAddress = this.normalizeAddress(address);
        this.protectedRegions.add(normalizedAddress);
    }

    /**
     * Remove protection from a memory address
     * @param address 16-bit address to unprotect
     */
    public unprotect(address: number): void {
        const normalizedAddress = this.normalizeAddress(address);
        this.protectedRegions.delete(normalizedAddress);
    }

    /**
     * Check if an address is protected
     * @param address 16-bit address to check
     * @returns true if address is protected
     */
    public isProtected(address: number): boolean {
        const normalizedAddress = this.normalizeAddress(address);
        return this.protectedRegions.has(normalizedAddress);
    }

    /**
     * Log an access violation
     * @param violation violation details to log
     */
    private logViolation(violation: AccessViolation): void {
        this.accessLog.push(violation);
        console.warn(`Memory ${violation.type} violation at 0x${violation.address.toString(16)}: ${violation.message}`);
    }

    /**
     * Check if a memory region is free (not allocated)
     * @param start starting address
     * @param size size of region
     * @returns true if region is free
     */
    private isRegionFree(start: number, size: number): boolean {
        // Check if region overlaps with any allocated regions
        for (const [allocStart, allocSize] of this.allocatedRegions) {
            if (start < (allocStart + allocSize) && (start + size) > allocStart) {
                return false;
            }
        }
        return true;
    }

    /**
     * Find the next boundary for allocation search
     * @param currentPos current position in memory
     * @returns size to skip to next boundary
     */
    private findNextAllocationBoundary(currentPos: number): number {
        let nextBoundary = this.SIZE;
        for (const [start, size] of this.allocatedRegions) {
            if (start > currentPos && start < nextBoundary) {
                nextBoundary = start;
            }
        }
        return nextBoundary - currentPos;
    }

    /**
     * Get access violation log
     * @returns array of logged violations
     */
    public getAccessLog(): AccessViolation[] {
        return [...this.accessLog];
    }

    /**
     * Clear access violation log
     */
    public clearAccessLog(): void {
        this.accessLog = [];
    }

    /**
     * Normalize address to ensure circular addressing
     * @param address raw address
     * @returns normalized address within bounds
     */
    private normalizeAddress(address: number): number {
        // Ensure positive value and wrap around
        return ((address % this.SIZE) + this.SIZE) % this.SIZE;
    }
}