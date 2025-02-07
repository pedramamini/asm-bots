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

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw cells
    this.cells.forEach((cell, index) => {
      const x = (index % this.gridSize.width) * this.cellSize.width;
      const y = Math.floor(index / this.gridSize.width) * this.cellSize.height;

      // Draw cell background
      this.ctx.fillStyle = this.getCellColor(cell);
      this.ctx.fillRect(x, y, this.cellSize.width, this.cellSize.height);

      // Draw cell border
      this.ctx.strokeStyle = '#444';
      this.ctx.strokeRect(x, y, this.cellSize.width, this.cellSize.height);

      // Draw instruction pointer indicator
      if (cell.isInstructionPointer) {
        this.drawInstructionPointer(x, y);
      }

      // Draw cell value
      this.ctx.fillStyle = '#000';
      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        cell.value.toString(16).padStart(2, '0'),
        x + this.cellSize.width / 2,
        y + this.cellSize.height / 2 + 4
      );
    });

    // Draw bot status
    this.drawBotStatus();
  }

  private getCellColor(cell: MemoryCell): string {
    if (cell.isInstructionPointer) {
      return '#ffeb3b'; // Highlight instruction pointer
    }
    if (cell.botId) {
      const bot = this.bots.get(cell.botId);
      return bot ? bot.color + '80' : '#ffffff'; // Add transparency to bot color
    }
    return '#ffffff';
  }

  private drawInstructionPointer(x: number, y: number) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + 2, y + 2);
    this.ctx.lineTo(x + this.cellSize.width - 2, y + 2);
    this.ctx.lineTo(x + this.cellSize.width / 2, y + this.cellSize.height - 2);
    this.ctx.closePath();
    this.ctx.fillStyle = '#ff9800';
    this.ctx.fill();
  }

  private drawBotStatus() {
    const padding = 10;
    let y = padding;

    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';

    this.bots.forEach(bot => {
      // Draw color indicator
      this.ctx.fillStyle = bot.color;
      this.ctx.fillRect(padding, y, 12, 12);

      // Draw bot name and instruction pointer
      this.ctx.fillStyle = '#000';
      this.ctx.fillText(
        `${bot.name} (IP: ${bot.instructionPointer})`,
        padding + 20,
        y + 10
      );

      y += 20;
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