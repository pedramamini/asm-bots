"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackedMemorySystem = void 0;
const MemorySystem_1 = require("./MemorySystem");
class TrackedMemorySystem extends MemorySystem_1.MemorySystem {
    constructor(size = 65536) {
        super(size);
        this.currentPid = null;
        this.owners = new Uint16Array(this.size);
    }
    setCurrentProcess(pid) {
        this.currentPid = pid;
    }
    /**
     * Overrides MemorySystem.write to update the ownership map.
     */
    write(address, value) {
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
    getOwner(address) {
        const addr = this.normalizeAddress(address);
        return this.owners[addr];
    }
    getOwners() {
        return new Uint16Array(this.owners);
    }
    setOwnershipRange(start, size, owner) {
        for (let i = 0; i < size; i++) {
            const addr = this.normalizeAddress(start + i);
            this.owners[addr] = owner;
        }
    }
}
exports.TrackedMemorySystem = TrackedMemorySystem;
