import { MemorySystem, AccessViolation } from './MemorySystem.js';

describe('MemorySystem', () => {
    let memory: MemorySystem;

    beforeEach(() => {
        memory = new MemorySystem();
    });

    afterEach(() => {
        memory.clearAccessLog();
    });

    describe('Memory Operations', () => {
        test('basic read/write operations work correctly', () => {
            memory.write(0x1000, 0x42);
            expect(memory.read(0x1000)).toBe(0x42);
        });

        test('write enforces 8-bit value limitation', () => {
            memory.write(0x1000, 0x1FF); // Write 511 (0x1FF)
            expect(memory.read(0x1000)).toBe(0xFF); // Should be truncated to 255 (0xFF)
        });

        test('out of bounds addresses are normalized', () => {
            // -2 should wrap to 0xFFFE
            memory.write(-2, 0x42);
            expect(memory.read(-2)).toBe(0x42);
            expect(memory.read(0xFFFE)).toBe(0x42);

            // 0x10000 should wrap to 0x0000
            memory.write(0x10000, 0x43);
            expect(memory.read(0x10000)).toBe(0x43);
            expect(memory.read(0)).toBe(0x43);
        });

        test('memory.write(0xFFFF + 1) wraps to 0x0000', () => {
            const testValue = 0x42;
            memory.write(0x10000, testValue); // This should wrap to 0x0000
            expect(memory.read(0x0000)).toBe(testValue);
        });

        test('negative addresses wrap around correctly', () => {
            const testValue = 0x42;
            memory.write(-1, testValue); // Should wrap to 0xFFFF
            expect(memory.read(0xFFFF)).toBe(testValue);
        });
    });

    describe('Memory Allocation', () => {
        test('memory.allocate(0x1000) returns valid address', () => {
            const addr = memory.allocate(0x1000);
            expect(addr).toBeGreaterThanOrEqual(0);
            expect(addr).toBeLessThan(0x10000);

            // Should be able to write to allocated memory
            memory.write(addr, 0x42);
            expect(memory.read(addr)).toBe(0x42);
        });

        test('allocation fails when no contiguous space available', () => {
            // Fill most of memory
            const addr1 = memory.allocate(0x8000);
            const addr2 = memory.allocate(0x7000);

            // Try to allocate more than remaining space
            expect(() => memory.allocate(0x2000)).toThrow('no contiguous space available');

            const log = memory.getAccessLog();
            expect(log).toHaveLength(1);
            expect(log[0].type).toBe('allocation');
        });

        test('freed memory can be reallocated', () => {
            const addr1 = memory.allocate(0x1000);
            memory.free(addr1);

            const addr2 = memory.allocate(0x1000);
            expect(addr2).toBe(addr1); // Should reuse the freed space
        });

        test('invalid free throws error', () => {
            expect(() => memory.free(0x1000)).toThrow('Invalid free address');
        });
    });

    describe('Memory Protection', () => {
        test('memory.protect() prevents writes and logs violations', () => {
            const address = 0x1000;
            memory.write(address, 0x42); // Initial write
            memory.protect(address);

            expect(() => {
                memory.write(address, 0x43);
            }).toThrow('Memory protection violation');

            // Check violation was logged
            const log = memory.getAccessLog();
            expect(log).toHaveLength(1);
            expect(log[0].type).toBe('protection');
            expect(log[0].address).toBe(address);
            expect(log[0].operation).toBe('write');

            // Original value should remain unchanged
            expect(memory.read(address)).toBe(0x42);
        });

        test('memory.unprotect() allows writes to previously protected addresses', () => {
            const address = 0x1000;
            memory.protect(address);
            memory.unprotect(address);

            expect(() => {
                memory.write(address, 0x42);
            }).not.toThrow();

            // No violations should be logged
            expect(memory.getAccessLog()).toHaveLength(0);
        });

        test('isProtected() correctly reports protection status', () => {
            const address = 0x1000;
            expect(memory.isProtected(address)).toBe(false);

            memory.protect(address);
            expect(memory.isProtected(address)).toBe(true);

            memory.unprotect(address);
            expect(memory.isProtected(address)).toBe(false);
        });

        test('protection works with circular addressing', () => {
            const address = 0x10000; // Will wrap to 0x0000
            memory.protect(address);

            expect(() => {
                memory.write(0x0000, 0x42);
            }).toThrow('Memory protection violation');

            // Check violation was logged
            const log = memory.getAccessLog();
            expect(log).toHaveLength(1);
            expect(log[0].type).toBe('protection');
            expect(log[0].address).toBe(0);

            expect(memory.isProtected(0x0000)).toBe(true);
        });

        test('multiple violations are logged correctly', () => {
            const address = 0x1000;
            memory.protect(address);

            // Attempt multiple writes
            try { memory.write(address, 0x42); } catch {}
            try { memory.write(address, 0x43); } catch {}
            try { memory.write(address, 0x44); } catch {}

            const log = memory.getAccessLog();
            expect(log).toHaveLength(3);
            expect(log.every((v: AccessViolation) => v.type === 'protection')).toBe(true);
            expect(log.every((v: AccessViolation) => v.address === address)).toBe(true);
        });
    });

    describe('Circular Addressing', () => {
        test('addresses wrap around at memory size boundary', () => {
            const testValue = 0x42;
            const memorySize = 0x10000; // 65536

            // Write at end of memory
            memory.write(0xFFFF, testValue);
            expect(memory.read(0xFFFF)).toBe(testValue);
            expect(memory.read(-1)).toBe(testValue);

            // Write beyond memory size
            memory.write(memorySize, testValue);
            expect(memory.read(0)).toBe(testValue);
        });

        test('large addresses wrap correctly', () => {
            const testValue = 0x42;
            memory.write(0x20000, testValue); // Should wrap to 0x0000
            expect(memory.read(0x0000)).toBe(testValue);

            memory.write(0x20001, testValue); // Should wrap to 0x0001
            expect(memory.read(0x0001)).toBe(testValue);
        });
    });
});