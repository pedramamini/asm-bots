/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface MemoryCell {
  address: number;
  value: number;
  isProtected: boolean;
  isActive: boolean;
}

export class MemoryDisplay {
  private cells: MemoryCell[] = [];
  private gridSize = { width: 16, height: 16 }; // 16x16 grid for 256 cells

  constructor(private canvas: HTMLCanvasElement) {
    this.initializeCells();
    this.render();
  }

  private initializeCells() {
    for (let i = 0; i < 256; i++) {
      this.cells.push({
        address: i,
        value: 0,
        isProtected: false,
        isActive: false,
      });
    }
  }

  public render() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const cellWidth = this.canvas.width / this.gridSize.width;
    const cellHeight = this.canvas.height / this.gridSize.height;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.cells.forEach((cell, index) => {
      const x = (index % this.gridSize.width) * cellWidth;
      const y = Math.floor(index / this.gridSize.width) * cellHeight;

      // Cell background
      ctx.fillStyle = this.getCellColor(cell);
      ctx.fillRect(x, y, cellWidth, cellHeight);

      // Cell border
      ctx.strokeStyle = '#444';
      ctx.strokeRect(x, y, cellWidth, cellHeight);

      // Cell value
      ctx.fillStyle = '#000';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        cell.value.toString(16).padStart(2, '0'),
        x + cellWidth / 2,
        y + cellHeight / 2
      );
    });
  }

  private getCellColor(cell: MemoryCell): string {
    if (cell.isActive) return '#ffeb3b';
    if (cell.isProtected) return '#f44336';
    return '#ffffff';
  }

  public update(address: number, value: number) {
    if (address >= 0 && address < this.cells.length) {
      this.cells[address].value = value;
      this.render();
    }
  }

  public highlight(address: number) {
    if (address >= 0 && address < this.cells.length) {
      this.cells[address].isActive = true;
      this.render();
      // Auto-clear highlight after a short delay
      setTimeout(() => {
        this.cells[address].isActive = false;
        this.render();
      }, 500);
    }
  }

  public setProtection(address: number, isProtected: boolean) {
    if (address >= 0 && address < this.cells.length) {
      this.cells[address].isProtected = isProtected;
      this.render();
    }
  }

  // For testing
  public getCellState(address: number): MemoryCell | undefined {
    return this.cells[address];
  }
}