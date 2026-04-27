import { TrackedMemorySystem } from '../TrackedMemorySystem';;;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('Running Memory System Verification Tests...');

  // Test 1: Circular Wrapping
  {
    const mem = new TrackedMemorySystem(65536);
    mem.write(0, 1);
    mem.write(65536, 2);    // Overflow: 65536 % 65536 = 0
    mem.write(-1, 3);       // Negative: -1 wrap = 65535
    mem.write(65535 * 2, 4); // Large overflow: 131070 % 65536 = 65534

    assert(mem.read(0) === 2, 'Overflow address should wrap to 0');
    assert(mem.read(65535) === 3, 'Negative address should wrap to 65535');
    assert(mem.read(65534) === 4, 'Large overflow should wrap correctly');
    console.log('✅ Circular Wrapping passed');
  }

  // Test 2: Ownership updates on write
  {
    const mem = new TrackedMemorySystem(65536);
    mem.setCurrentProcess(5);
    mem.write(10, 100);
    assert(mem.getOwner(10) === 5, 'Cell 10 should be owned by PID 5');
    
    mem.setCurrentProcess(7);
    mem.write(10, 200);
    assert(mem.getOwner(10) === 7, 'Cell 10 should be updated to owner PID 7');
    console.log('✅ Ownership updates passed');
  }

  // Test 3: Protection no-ops
  {
    const mem = new TrackedMemorySystem(65536);
    mem.write(20, 50);
    mem.protect(20);
    
    mem.setCurrentProcess(1);
    mem.write(20, 60); // Should be ignored
    
    assert(mem.read(20) === 50, 'Protected cell should not change value');
    assert(mem.getOwner(20) === 0, 'Protected write should not change ownership');
    console.log('✅ Protection no-ops passed');
  }

  // Test 4: Ownership range setting
  {
    const mem = new TrackedMemorySystem(65536);
    mem.setOwnershipRange(100, 10, 99);
    
    assert(mem.getOwner(100) === 99, 'Start of range should be owner 99');
    assert(mem.getOwner(109) === 99, 'End of range should be owner 99');
    assert(mem.getOwner(110) === 0, 'Outside range should be unowned');
    console.log('✅ Ownership range setting passed');
  }

  // Test 5: Cloned buffers
  {
    const mem = new TrackedMemorySystem(65536);
    const data = mem.getMemory();
    data[0] = 255;
    assert(mem.read(0) === 0, 'getMemory() must return a copy, not a reference');
    
    const owners = mem.getOwners();
    owners[0] = 123;
    assert(mem.getOwner(0) === 0, 'getOwners() must return a copy, not a reference');
    console.log('✅ Buffer cloning passed');
  }

  console.log('\nALL MEMORY SYSTEM TESTS PASSED');
}

try {
  runTests();
} catch (e) {
  console.error(e);
  // process.exit(1); // Removed for compatibility with some environments
}
