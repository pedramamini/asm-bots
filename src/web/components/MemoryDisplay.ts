/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface Bot {
  id: string;
  name: string;
  color: string;
  instructionPointer: number;
  memory: Uint8Array;
}

interface MemoryCell {
  address: number;
  value: number;
  botId?: string;  // ID of bot that wrote to this cell
  isInstructionPointer: boolean;
}

export class MemoryDisplay {
  private cells: MemoryCell[] = [];
  private bots: Map<string, Bot> = new Map();
  private gridSize = { width: 32, height: 32 }; // 32x32 grid for 1024 cells
  private cellSize = { width: 20, height: 20 };
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    // Set canvas size based on grid and cell size
    this.canvas.width = this.gridSize.width * this.cellSize.width;
    this.canvas.height = this.gridSize.height * this.cellSize.height;

    this.initializeCells();
    this.render();

    // Add hover effect for cell inspection
    this.setupHoverEffect();
  }

  private initializeCells() {
    const totalCells = this.gridSize.width * this.gridSize.height;
    for (let i = 0; i < totalCells; i++) {
      this.cells.push({
        address: i,
        value: 0,
        isInstructionPointer: false
      });
    }
  }

  public updateBot(bot: Bot) {
    this.bots.set(bot.id, bot);
    this.updateInstructionPointers();
    this.render();
  }

  public removeBot(botId: string) {
    this.bots.delete(botId);
    // Clear bot's memory ownership
    this.cells.forEach(cell => {
      if (cell.botId === botId) {
        cell.botId = undefined;
      }
    });
    this.render();
  }

  private updateInstructionPointers() {
    // Reset all instruction pointers
    this.cells.forEach(cell => cell.isInstructionPointer = false);

    // Set new instruction pointer positions
    this.bots.forEach(bot => {
      if (bot.instructionPointer >= 0 && bot.instructionPointer < this.cells.length) {
        this.cells[bot.instructionPointer].isInstructionPointer = true;
      }
    });
  }

  public updateMemory(address: number, value: number, botId: string) {
    if (address >= 0 && address < this.cells.length) {
      this.cells[address].value = value;
      this.cells[address].botId = botId;
      this.render();
    }
  }

  private render() {
    if (!this.ctx) return;

    // Request animation frame for continuous rendering (helps with animations)
    requestAnimationFrame(() => this.render());

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid background
    this.ctx.fillStyle = '#f5f5f5';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw cells
    this.cells.forEach((cell, index) => {
      const x = (index % this.gridSize.width) * this.cellSize.width;
      const y = Math.floor(index / this.gridSize.width) * this.cellSize.height;

      // Draw cell background
      this.ctx.fillStyle = this.getCellColor(cell);
      this.ctx.fillRect(x, y, this.cellSize.width, this.cellSize.height);

      // Draw cell border (lighter for better visibility)
      this.ctx.strokeStyle = '#ddd';
      this.ctx.strokeRect(x, y, this.cellSize.width, this.cellSize.height);

      // Draw instruction pointer indicator
      if (cell.isInstructionPointer) {
        this.drawInstructionPointer(x, y);
      }

      // Draw cell value (darker for better readability)
      // Determine text color based on background brightness for better contrast
      const bgColor = this.getCellColor(cell);
      const brightness = this.getColorBrightness(bgColor);
      this.ctx.fillStyle = brightness > 160 ? '#000' : '#fff';
      
      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        cell.value.toString(16).padStart(2, '0').toUpperCase(),
        x + this.cellSize.width / 2,
        y + this.cellSize.height / 2 + 4
      );
    });

    // Draw bot status
    this.drawBotStatus();
  }
  
  // Helper method to determine color brightness (for text contrast)
  private getColorBrightness(hexColor: string): number {
    // Remove alpha component if present
    const hex = hexColor.substring(0, 7);
    // Convert hex to RGB
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    // Calculate brightness using common formula
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  private getCellColor(cell: MemoryCell): string {
    // Base color
    let baseColor = '#ffffff';
    
    // Bot-owned memory cell
    if (cell.botId) {
      const bot = this.bots.get(cell.botId);
      if (bot) {
        // Use more vibrant colors with less transparency
        baseColor = bot.color + 'C0'; // Higher alpha (C0 = 75% opacity)
      }
    }
    
    // Highlight instruction pointer with a border effect instead of changing the base color
    if (cell.isInstructionPointer) {
      return baseColor; // We'll draw a special border for the IP in the render method
    }
    
    return baseColor;
  }

  private drawInstructionPointer(x: number, y: number) {
    // Draw blinking border to highlight instruction pointer
    const time = Date.now() % 800; // 800ms cycle
    const alpha = time < 400 ? time / 400 : (800 - time) / 400; // Pulse effect
    
    // Draw animated border
    this.ctx.strokeStyle = `rgba(255, 152, 0, ${0.5 + alpha * 0.5})`; // Orange with pulsing opacity
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x, y, this.cellSize.width, this.cellSize.height);
    this.ctx.lineWidth = 1;
    
    // Draw small triangle indicator in the corner
    this.ctx.beginPath();
    this.ctx.moveTo(x + 2, y + 2);
    this.ctx.lineTo(x + 10, y + 2);
    this.ctx.lineTo(x + 2, y + 10);
    this.ctx.closePath();
    this.ctx.fillStyle = '#ff9800';
    this.ctx.fill();
  }

  private drawBotStatus() {
    const padding = 10;
    let y = padding;

    // Draw status panel background
    this.ctx.fillStyle = 'rgba(240, 240, 240, 0.8)';
    this.ctx.fillRect(
      padding - 5, 
      padding - 5, 
      200, 
      (this.bots.size * 30) + 10
    );
    this.ctx.strokeStyle = '#888';
    this.ctx.strokeRect(
      padding - 5, 
      padding - 5, 
      200, 
      (this.bots.size * 30) + 10
    );

    // Title
    this.ctx.font = 'bold 14px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = '#333';
    this.ctx.fillText('BOT STATUS', padding, y + 8);
    y += 25;

    this.ctx.font = '12px monospace';
    
    // For each bot
    this.bots.forEach(bot => {
      // Draw color box with border
      this.ctx.fillStyle = bot.color;
      this.ctx.fillRect(padding, y, 16, 16);
      this.ctx.strokeStyle = '#000';
      this.ctx.strokeRect(padding, y, 16, 16);

      // Draw bot name and instruction pointer with IP in hex
      this.ctx.fillStyle = '#000';
      this.ctx.fillText(
        `${bot.name}`,
        padding + 25,
        y + 13
      );
      
      // Display IP in hex format
      const ipHex = '0x' + bot.instructionPointer.toString(16).toUpperCase().padStart(4, '0');
      this.ctx.fillText(
        `IP: ${ipHex}`,
        padding + 120,
        y + 13
      );

      y += 30;
    });
  }

  private setupHoverEffect() {
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const cellX = Math.floor(x / this.cellSize.width);
      const cellY = Math.floor(y / this.cellSize.height);
      const index = cellY * this.gridSize.width + cellX;

      if (index >= 0 && index < this.cells.length) {
        const cell = this.cells[index];
        const bot = cell.botId ? this.bots.get(cell.botId) : undefined;

        // Update tooltip or status display with cell info
        const tooltip = `Address: ${cell.address.toString(16).padStart(4, '0')}
Value: ${cell.value.toString(16).padStart(2, '0')}
Bot: ${bot ? bot.name : 'None'}`;

        this.canvas.title = tooltip;
      }
    });
  }
}