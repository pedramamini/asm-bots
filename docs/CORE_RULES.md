# Core Wars Technical Specification

## Memory Model

### Memory Space
- 16-bit addressable memory (0x0000 to 0xFFFF)
- Word-aligned access (2 bytes per instruction)
- Circular addressing (overflow wraps to 0x0000)
- Protected zero page (0x0000 - 0x00FF)
- Segmented bot loading zones

### Memory Access
- Read: Load instruction/data from memory
- Write: Store instruction/data to memory
- Execute: Fetch and run instruction
- Protect: Mark memory as read-only

## Instruction Set

### Basic Instructions
```assembly
MOV   dest, src    ; Move data between registers/memory
ADD   dest, src    ; Add source to destination
SUB   dest, src    ; Subtract source from destination
CMP   op1, op2     ; Compare operands
JMP   addr         ; Unconditional jump
JZ    addr         ; Jump if zero
JNZ   addr         ; Jump if not zero
CALL  addr         ; Push PC and jump
RET               ; Pop PC and jump back
```

### Advanced Instructions
```assembly
MUL   dest, src    ; Multiply
DIV   dest, src    ; Divide
AND   dest, src    ; Logical AND
OR    dest, src    ; Logical OR
XOR   dest, src    ; Logical XOR
SHL   dest, count  ; Shift left
SHR   dest, count  ; Shift right
```

### Addressing Modes
1. Register Direct: `MOV AX, BX`
2. Immediate: `MOV AX, 0x100`
3. Memory Direct: `MOV [0x100], AX`
4. Register Indirect: `MOV [BX], AX`
5. Indexed: `MOV [BX + 0x10], AX`

## Battle System

### Initialization
1. Memory cleared to 0x00
2. Bots loaded at random positions
3. Register sets initialized
4. Protection maps created

### Execution Cycle
1. Bot selection (round-robin)
2. Instruction fetch
3. Decode and validate
4. Execute instruction
5. Update memory state
6. Check victory conditions

### Victory Conditions
1. Last bot running
2. Most processes alive
3. Highest execution count
4. Control of memory regions

### Battle Termination
- Maximum cycles reached
- Single bot remaining
- All bots terminated
- Manual intervention

## Process Management

### Bot Process
- Instruction pointer
- Register set
- Status flags
- Process ID
- Parent bot ID

### Multi-Processing
- Process creation via SPL instruction
- Process queue per bot
- Round-robin scheduling
- Process termination

## Security Measures

### Memory Protection
- Read-only segments
- Execute-only segments
- Invalid instruction detection
- Infinite loop prevention

### Validation
- Instruction syntax
- Memory bounds
- Operation legality
- Resource limits

## Performance Considerations

### Optimization
- Instruction caching
- Memory access patterns
- Process scheduling
- State tracking

### Resource Limits
- Maximum processes per bot
- Instruction cycle limit
- Memory write quota
- Creation restrictions

## Battle Recording

### State Tracking
- Memory snapshots
- Register states
- Process lists
- Event log

### Replay Format
```json
{
  "metadata": {
    "timestamp": "2025-02-04T17:25:00Z",
    "players": ["Bot1", "Bot2"],
    "format": "2.0"
  },
  "states": [
    {
      "cycle": 0,
      "memory": "base64_encoded_memory_dump",
      "processes": [{
        "bot": "Bot1",
        "pid": 1,
        "ip": "0x100",
        "registers": {"ax": "0x0", "bx": "0x0"}
      }],
      "events": ["Bot1 loaded at 0x100"]
    }
  ]
}
```

## Error Handling

### Runtime Errors
1. Invalid instruction
2. Memory access violation
3. Division by zero
4. Resource exhaustion

### Error Response
1. Process termination
2. Event logging
3. State preservation
4. Notification dispatch

## Implementation Guidelines

### Code Organization
- Modular components
- Clear interfaces
- Error boundaries
- Performance monitoring

### Testing Requirements
- Unit test coverage (80%+)
- Integration testing
- Performance benchmarks
- Security validation

### Documentation
- API specifications
- State diagrams
- Memory maps
- Error codes