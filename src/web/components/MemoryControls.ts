/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { MemoryDisplay } from "./MemoryDisplay.ts";

export interface ExecutionState {
  isRunning: boolean;
  currentAddress: number;
  currentInstruction: string;
}

export class MemoryControls {
  private display: MemoryDisplay;
  private state: ExecutionState = {
    isRunning: false,
    currentAddress: 0,
    currentInstruction: '',
  };

  constructor(
    private container: HTMLElement,
    canvas: HTMLCanvasElement
  ) {
    this.display = new MemoryDisplay(canvas);
    this.initializeControls();
  }

  private initializeControls() {
    const controls = document.createElement('div');
    controls.className = 'memory-controls';

    // Execution Controls
    const execControls = document.createElement('div');
    execControls.className = 'execution-controls';

    const playButton = document.createElement('button');
    playButton.textContent = '▶';
    playButton.onclick = () => this.toggleExecution();

    const stepButton = document.createElement('button');
    stepButton.textContent = '⏭';
    stepButton.onclick = () => this.step();

    const resetButton = document.createElement('button');
    resetButton.textContent = '⟲';
    resetButton.onclick = () => this.reset();

    execControls.append(playButton, stepButton, resetButton);

    // Memory Inspector
    const inspector = document.createElement('div');
    inspector.className = 'memory-inspector';

    const addressInput = document.createElement('input');
    addressInput.type = 'text';
    addressInput.placeholder = 'Address (hex)';

    const inspectButton = document.createElement('button');
    inspectButton.textContent = 'Inspect';
    inspectButton.onclick = () => {
      const address = parseInt(addressInput.value, 16);
      if (!isNaN(address)) {
        this.inspect(address);
      }
    };

    inspector.append(addressInput, inspectButton);

    // Status Display
    const status = document.createElement('div');
    status.className = 'execution-status';
    status.innerHTML = `
      <div>Address: <span id="current-address">0x0000</span></div>
      <div>Instruction: <span id="current-instruction">-</span></div>
    `;

    controls.append(execControls, inspector, status);
    this.container.appendChild(controls);
  }

  public toggleExecution() {
    this.state.isRunning = !this.state.isRunning;
    if (this.state.isRunning) {
      this.runExecution();
    }
  }

  private async runExecution() {
    while (this.state.isRunning) {
      await this.step();
      await new Promise(resolve => setTimeout(resolve, 100)); // Execution delay
    }
  }

  public async step() {
    // Simulate instruction execution
    this.state.currentAddress = (this.state.currentAddress + 1) & 0xFFFF;
    this.display.highlight(this.state.currentAddress);
    this.updateStatus();
  }

  public reset() {
    this.state.isRunning = false;
    this.state.currentAddress = 0;
    this.state.currentInstruction = '';
    this.updateStatus();
  }

  public inspect(address: number) {
    const cell = this.display.getCellState(address);
    if (cell) {
      this.display.highlight(address);
      // Show cell details in a popup or status area
      const details = `Address: 0x${address.toString(16).padStart(4, '0')}
Value: 0x${cell.value.toString(16).padStart(2, '0')}
Protected: ${cell.isProtected}`;
      alert(details); // In a real implementation, use a proper UI component
    }
  }

  private updateStatus() {
    const addressElem = document.getElementById('current-address');
    const instructionElem = document.getElementById('current-instruction');

    if (addressElem) {
      addressElem.textContent = `0x${this.state.currentAddress.toString(16).padStart(4, '0')}`;
    }
    if (instructionElem) {
      instructionElem.textContent = this.state.currentInstruction || '-';
    }
  }
}