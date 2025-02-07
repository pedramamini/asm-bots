class BattleDashboard {
  constructor(container) {
    this.container = container;
    this.bots = new Map();
    this.metrics = {
      executionSpeed: 0,
      memoryEfficiency: 0,
      battleProgress: 0,
    };
    this.initializeDashboard();
  }

  initializeDashboard() {
    const dashboard = document.createElement('div');
    dashboard.className = 'battle-dashboard';
    dashboard.innerHTML = `
      <div class="bot-status-container">
        <h3>Bot Status</h3>
        <div id="botList" class="bot-list"></div>
      </div>
      <div class="metrics-container">
        <h3>Performance Metrics</h3>
        <div class="metrics-grid">
          <div class="metric">
            <label>Execution Speed</label>
            <span id="execSpeed">0 IPS</span>
          </div>
          <div class="metric">
            <label>Memory Efficiency</label>
            <span id="memEfficiency">0%</span>
          </div>
          <div class="metric">
            <label>Battle Progress</label>
            <span id="battleProgress">0%</span>
          </div>
        </div>
      </div>
      <div class="control-panel">
        <h3>Control Panel</h3>
        <div class="control-buttons">
          <button id="startBattle">Start Battle</button>
          <button id="pauseBattle">Pause</button>
          <button id="resetBattle">Reset</button>
        </div>
      </div>
    `;
    this.container.appendChild(dashboard);
    this.setupEventListeners();
  }

  setupEventListeners() {
    const startBtn = document.getElementById('startBattle');
    const pauseBtn = document.getElementById('pauseBattle');
    const resetBtn = document.getElementById('resetBattle');

    startBtn?.addEventListener('click', () => this.startBattle());
    pauseBtn?.addEventListener('click', () => this.pauseBattle());
    resetBtn?.addEventListener('click', () => this.resetBattle());
  }

  updateBotStatus(bot) {
    this.bots.set(bot.id, bot);
    this.renderBotList();
  }

  updateMetrics(metrics) {
    Object.assign(this.metrics, metrics);
    this.renderMetrics();
  }

  renderBotList() {
    const botList = document.getElementById('botList');
    if (!botList) return;

    botList.innerHTML = '';
    this.bots.forEach(bot => {
      const botElement = document.createElement('div');
      botElement.className = `bot-item ${bot.state}`;
      botElement.innerHTML = `
        <div class="bot-header">
          <span class="bot-name">${bot.name}</span>
          <span class="bot-state">${bot.state}</span>
        </div>
        <div class="bot-details">
          <div>Memory: ${bot.memoryUsage}%</div>
          <div>Cycles: ${bot.cyclesExecuted}</div>
          <div>Last: ${bot.lastInstruction}</div>
        </div>
      `;
      botList.appendChild(botElement);
    });
  }

  renderMetrics() {
    const execSpeed = document.getElementById('execSpeed');
    const memEfficiency = document.getElementById('memEfficiency');
    const battleProgress = document.getElementById('battleProgress');

    if (execSpeed) execSpeed.textContent = `${this.metrics.executionSpeed.toFixed(1)} IPS`;
    if (memEfficiency) memEfficiency.textContent = `${this.metrics.memoryEfficiency.toFixed(1)}%`;
    if (battleProgress) battleProgress.textContent = `${this.metrics.battleProgress.toFixed(1)}%`;
  }

  startBattle() {
    this.updateMetrics({ battleProgress: 0 });
    this.container.dispatchEvent(new CustomEvent('battleStart'));
  }

  pauseBattle() {
    this.container.dispatchEvent(new CustomEvent('battlePause'));
  }

  resetBattle() {
    this.bots.clear();
    this.updateMetrics({
      executionSpeed: 0,
      memoryEfficiency: 0,
      battleProgress: 0,
    });
    this.renderBotList();
    this.container.dispatchEvent(new CustomEvent('battleReset'));
  }
}

class MemoryDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.initializeDisplay();
  }

  initializeDisplay() {
    // Set up initial canvas state
    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  updateMemory(data) {
    // Example visualization - each byte as a colored pixel
    const imageData = this.ctx.createImageData(512, 512);
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const offset = i * 4;
      imageData.data[offset] = value;     // R
      imageData.data[offset + 1] = value; // G
      imageData.data[offset + 2] = value; // B
      imageData.data[offset + 3] = 255;   // A
    }
    this.ctx.putImageData(imageData, 0, 0);
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('memoryCanvas');
  const battleDashboard = document.getElementById('battleDashboard');

  if (canvas && battleDashboard) {
    const display = new MemoryDisplay(canvas);
    const dashboard = new BattleDashboard(battleDashboard);

    // Example: Add a test bot
    dashboard.updateBotStatus({
      id: 'test-bot',
      name: 'Test Bot',
      memoryUsage: 45,
      cyclesExecuted: 1000,
      state: 'running',
      lastInstruction: 'MOV A, B'
    });

    // Example: Update performance metrics
    dashboard.updateMetrics({
      executionSpeed: 1000,
      memoryEfficiency: 75,
      battleProgress: 30
    });

    // Example: Update memory display with random data
    const randomData = new Uint8Array(512 * 512);
    for (let i = 0; i < randomData.length; i++) {
      randomData[i] = Math.random() * 255;
    }
    display.updateMemory(randomData);
  }
});