// Memory visualization system for ASM-Bots
export class MemoryVisualization {
  constructor(canvas, memorySize = 65536) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.memorySize = memorySize;
    
    // Visualization parameters
    this.cellSize = 8; // Default size of each memory cell in pixels
    this.columns = 256; // Memory cells per row
    this.rows = Math.ceil(memorySize / this.columns);
    this.leftMargin = 50; // Space for hex addresses
    this.topMargin = 20; // Space for column numbers
    
    // Bot colors (up to 8 bots)
    this.botColors = [
      '#FF6B6B', // Red
      '#4ECDC4', // Teal
      '#45B7D1', // Blue
      '#96CEB4', // Green
      '#FFEAA7', // Yellow
      '#DDA0DD', // Plum
      '#98D8C8', // Mint
      '#F8B500'  // Orange
    ];
    
    // Memory state
    this.memory = new Uint8Array(memorySize);
    this.owners = new Uint8Array(memorySize); // Which bot owns each cell
    this.accessMap = new Map(); // Track recent accesses
    this.processMap = new Map(); // Map process IDs to colors
    
    this.setupCanvas();
  }
  
  setupCanvas() {
    // Set canvas size based on memory visualization needs with margins
    this.updateCanvasSize();
    
    // Initial render
    this.render();
  }
  
  // Update memory cell with owner information
  updateMemory(address, value, ownerId) {
    if (address < 0 || address >= this.memorySize) return;
    
    this.memory[address] = value;
    this.owners[address] = ownerId;
    
    // Debug logging for first few updates
    if (this.debugCount < 10) {
      console.log(`Memory update: addr=0x${address.toString(16)}, value=${value}, owner=${ownerId}`);
      console.log(`ProcessMap has:`, Array.from(this.processMap.keys()));
      console.log(`Process for owner ${ownerId}:`, this.processMap.get(ownerId));
      this.debugCount = (this.debugCount || 0) + 1;
    }
    
    // Track access for animation
    this.accessMap.set(address, {
      time: Date.now(),
      type: 'write'
    });
    
    // Clean old accesses
    this.cleanAccessMap();
    
    // Force immediate render on first updates to ensure colors show
    if (this.debugCount <= 5) {
      this.render();
    }
  }
  
  // Update a range of memory
  updateMemoryRange(startAddress, data, ownerId) {
    for (let i = 0; i < data.length; i++) {
      const addr = (startAddress + i) % this.memorySize;
      this.updateMemory(addr, data[i], ownerId);
    }
  }
  
  // Mark a memory access for visualization
  markAccess(address, type) {
    if (address >= 0 && address < this.memorySize) {
      this.accessMap.set(address, {
        time: Date.now(),
        type: type
      });
    }
  }
  
  // Register a process with a color
  registerProcess(processId, botName, colorIndex) {
    this.processMap.set(processId, {
      name: botName,
      color: this.botColors[colorIndex % this.botColors.length],
      pc: 0, // Program counter
      active: true
    });
  }
  
  // Update process program counter
  updateProcessPC(processId, pc) {
    const process = this.processMap.get(processId);
    if (process) {
      process.pc = pc;
      
      // Track PC access for highlighting
      this.accessMap.set(pc, {
        time: Date.now(),
        type: 'execute'
      });
    }
  }
  
  // Mark process as terminated
  terminateProcess(processId) {
    const process = this.processMap.get(processId);
    if (process) {
      process.active = false;
    }
  }
  
  // Clean old access entries
  cleanAccessMap() {
    const now = Date.now();
    const fadeTime = 1000; // 1 second fade
    
    for (const [addr, access] of this.accessMap.entries()) {
      if (now - access.time > fadeTime) {
        this.accessMap.delete(addr);
      }
    }
  }
  
  // Main render function
  render() {
    // Clear canvas - use darker background in dark mode
    const isDarkMode = document.body.classList.contains('dark-theme');
    this.ctx.fillStyle = isDarkMode ? '#0a0a0a' : '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw hex addresses on the left
    this.ctx.fillStyle = isDarkMode ? '#666' : '#999';
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'right';
    
    // Draw row addresses every 8 rows for more detail
    for (let row = 0; row < this.rows; row += 8) {
      const addr = row * this.columns;
      const hexAddr = '0x' + addr.toString(16).padStart(4, '0').toUpperCase();
      const y = row * this.cellSize + this.topMargin + 10;
      
      // Make every 16th row bolder
      if (row % 16 === 0) {
        this.ctx.font = 'bold 10px monospace';
      } else {
        this.ctx.font = '9px monospace';
      }
      
      this.ctx.fillText(hexAddr, this.leftMargin - 5, y);
    }
    
    // Draw grid lines for better visibility
    this.ctx.strokeStyle = isDarkMode ? '#333' : '#ddd';
    this.ctx.lineWidth = 0.5;
    
    // Vertical grid lines
    for (let col = 0; col <= this.columns; col++) {
      const x = col * this.cellSize + this.leftMargin;
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.topMargin);
      this.ctx.lineTo(x, this.rows * this.cellSize + this.topMargin);
      this.ctx.stroke();
    }
    
    // Horizontal grid lines
    for (let row = 0; row <= this.rows; row++) {
      const y = row * this.cellSize + this.topMargin;
      this.ctx.beginPath();
      this.ctx.moveTo(this.leftMargin, y);
      this.ctx.lineTo(this.columns * this.cellSize + this.leftMargin, y);
      this.ctx.stroke();
    }
    
    // Render memory cells
    for (let i = 0; i < this.memorySize; i++) {
      const x = (i % this.columns) * this.cellSize + this.leftMargin;
      const y = Math.floor(i / this.columns) * this.cellSize + this.topMargin;
      
      // Determine cell color
      let color = isDarkMode ? '#1a1a1a' : '#111111'; // Empty memory
      
      if (this.memory[i] !== 0) {
        const ownerId = this.owners[i];
        if (ownerId !== undefined && ownerId !== null) {
          // Find process color by exact ID match
          const process = this.processMap.get(ownerId);
          if (process) {
            color = this.hexToRgba(process.color, 0.7);
            // Debug first colored cell
            if (!this.colorDebugDone) {
              console.log(`SUCCESS: Coloring cell ${i} with owner ${ownerId}, process found:`, process);
              console.log(`Cell color will be:`, color);
              this.colorDebugDone = true;
            }
          } else {
            // Debug missing process
            if (!this.missingDebugDone && ownerId !== 0) {
              console.log(`ERROR: Owner ${ownerId} not found in processMap!`);
              console.log(`Available processes:`, Array.from(this.processMap.entries()));
              this.missingDebugDone = true;
            }
          }
        }
      }
      
      // Check if this is a current PC location
      let isPC = false;
      for (const [pid, process] of this.processMap.entries()) {
        if (process.pc === i && process.active) {
          // This is a program counter - use bright white outline
          isPC = true;
          break;
        }
      }
      
      // Check for recent access
      const access = this.accessMap.get(i);
      if (access) {
        const age = (Date.now() - access.time) / 1000; // Age in seconds
        const brightness = Math.max(0.3, 1 - age); // Fade effect but keep minimum brightness
        
        if (access.type === 'execute') {
          // Program counter trail - bright yellow
          color = `rgba(255, 235, 59, ${brightness})`;
        } else if (access.type === 'write') {
          // Recent write - white flash
          color = `rgba(255, 255, 255, ${brightness * 0.8})`;
        }
      }
      
      // Draw cell with slight gap for grid visibility
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, y, this.cellSize - 1, this.cellSize - 1);
      
      // Draw bright outline for current PC
      if (isPC) {
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x - 0.5, y - 0.5, this.cellSize + 1, this.cellSize + 1);
      }
    }
    
    // Draw process indicators
    this.drawProcessIndicators();
  }
  
  // Draw current PC positions for active processes
  drawProcessIndicators() {
    for (const [processId, process] of this.processMap.entries()) {
      if (!process.active || process.pc >= this.memorySize) continue;
      
      const x = (process.pc % this.columns) * this.cellSize;
      const y = Math.floor(process.pc / this.columns) * this.cellSize;
      
      // Draw a small border around PC
      this.ctx.strokeStyle = '#FFFFFF';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x - 1, y - 1, this.cellSize + 1, this.cellSize + 1);
    }
  }
  
  // Helper to convert hex to rgba
  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // Start animation loop
  startAnimation() {
    const animate = () => {
      this.render();
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }
  
  // Stop animation
  stopAnimation() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }
  
  // Clear all memory
  clear() {
    this.memory.fill(0);
    this.owners.fill(0);
    this.accessMap.clear();
    this.debugCount = 0;
    this.colorDebugDone = false;
    this.missingDebugDone = false;
    console.log('Memory visualization cleared');
    this.render();
  }
  
  // Update cell size and re-render
  setCellSize(newSize) {
    this.cellSize = newSize;
    // Keep the same grid layout, just change cell size
    this.updateCanvasSize();
    this.render();
  }
  
  // Update canvas dimensions based on cell size
  updateCanvasSize() {
    this.canvas.width = this.columns * this.cellSize + this.leftMargin;
    this.canvas.height = this.rows * this.cellSize + this.topMargin;
  }
}