"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemorySystem = void 0;
class MemorySystem {
    size;
    buffer;
    protectedAddresses = new Set();
    constructor(size = 65536) {
        this.size = size;
        this.buffer = new Uint8Array(this.size);
    }
    /**
     * Normalizes the address using circular wrapping: ((addr % SIZE) + SIZE) % SIZE
     */
    normalizeAddress(address) {
        return ((address % this.size) + this.size) % this.size;
    }
    read(address) {
        const addr = this.normalizeAddress(address);
        return this.buffer[addr];
    }
    write(address, value) {
        const addr = this.normalizeAddress(address);
        if (this.isProtected(addr)) {
            console.warn(`Memory violation: Attempted write to protected address ${addr}`);
            return;
        }
        this.buffer[addr] = value & 0xFF;
    }
    protect(address) {
        this.protectedAddresses.add(this.normalizeAddress(address));
    }
    unprotect(address) {
        this.protectedAddresses.delete(this.normalizeAddress(address));
    }
    isProtected(address) {
        return this.protectedAddresses.has(this.normalizeAddress(address));
    }
    getMemory() {
        return new Uint8Array(this.buffer);
    }
}
exports.MemorySystem = MemorySystem;
