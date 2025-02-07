class BattleDashboard {
  constructor(container) {
    this.container = container;
    this.bots = new Map();
    this.metrics = {
      executionSpeed: 0,
      memoryEfficiency: 0,
      battleProgress: 0,
    };
    this.connectWebSocket();
    this.initializeDashboard();
  }

  connectWebSocket() {
    console.log('Connecting to WebSocket...');
    this.ws = new WebSocket(`ws://${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      console.log('WebSocket message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'bots':
            console.log('Updating bots:', message.data);
            message.data.forEach(bot => this.updateBotStatus(bot));
            break;
          case 'battles':
            console.log('Updating battles:', message.data);
            message.data.forEach(battle => this.updateBattleStatus(battle));
            break;
          case 'metrics':
            console.log('Updating metrics:', message.data);
            this.updateMetrics(message.data);
            break;
          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setTimeout(() => this.connectWebSocket(), 1000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
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
    console.log('Updating bot status:', bot);
    this.bots.set(bot.id, bot);
    this.renderBotList();
  }

  updateBattleStatus(battle) {
    console.log('Updating battle status:', battle);
    if (battle.status === 'running') {
      this.updateMetrics({
        executionSpeed: 1000,
        memoryEfficiency: 75,
        battleProgress: 30
      });
    }
  }

  updateMetrics(metrics) {
    console.log('Updating metrics:', metrics);
    Object.assign(this.metrics, metrics);
    this.renderMetrics();
  }

  renderBotList() {
    const botList = document.getElementById('botList');
    if (!botList) return;

    botList.innerHTML = '';
    this.bots.forEach(bot => {
      const botElement = document.createElement('div');
      botElement.className = `bot-item ${bot.state || 'waiting'}`;
      botElement.innerHTML = `
        <div class="bot-header">
          <span class="bot-name">${bot.name}</span>
          <span class="bot-state">${bot.state || 'waiting'}</span>
        </div>
        <div class="bot-details">
          <div>Memory: ${bot.memoryUsage || 0}%</div>
          <div>Cycles: ${bot.cyclesExecuted || 0}</div>
          <div>Last: ${bot.lastInstruction || 'None'}</div>
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
    if (this.bots.size < 2) {
      alert('Need at least 2 bots to start a battle');
      return;
    }

    console.log('Starting battle with bots:', Array.from(this.bots.keys()));
    const botIds = Array.from(this.bots.keys());
    fetch('/api/battles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botIds: botIds.slice(0, 2) })
    }).then(response => response.json())
      .then(data => console.log('Battle created:', data))
      .catch(error => console.error('Error creating battle:', error));
  }

  pauseBattle() {
    console.log('Pausing battle');
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pause' }));
    }
  }

  resetBattle() {
    console.log('Resetting battle');
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
  }
}

class MemoryDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.initializeDisplay();
  }

  initializeDisplay() {
    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  updateMemory(data) {
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
  console.log('Initializing application...');
  const canvas = document.getElementById('memoryCanvas');
  const battleDashboard = document.getElementById('battleDashboard');

  if (canvas && battleDashboard) {
    console.log('Found required elements, creating components...');
    const display = new MemoryDisplay(canvas);
    const dashboard = new BattleDashboard(battleDashboard);

    // Example: Update memory display with random data
    const randomData = new Uint8Array(512 * 512);
    for (let i = 0; i < randomData.length; i++) {
      randomData[i] = Math.random() * 255;
    }
    display.updateMemory(randomData);
  } else {
    console.error('Required elements not found:', { canvas, battleDashboard });
  }
});