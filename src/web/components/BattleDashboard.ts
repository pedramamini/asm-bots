/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface BotStatus {
  id: string;
  name: string;
  memoryUsage: number;
  cyclesExecuted: number;
  state: 'running' | 'waiting' | 'terminated';
  lastInstruction: string;
}

interface PerformanceMetrics {
  executionSpeed: number; // instructions per second
  memoryEfficiency: number; // percentage of memory utilized
  battleProgress: number; // percentage complete
}

export class BattleDashboard {
  private bots: Map<string, BotStatus> = new Map();
  private metrics: PerformanceMetrics = {
    executionSpeed: 0,
    memoryEfficiency: 0,
    battleProgress: 0,
  };

  constructor(private container: HTMLElement) {
    this.initializeDashboard();
  }

  private initializeDashboard() {
    const dashboard = document.createElement('div');
    dashboard.className = 'battle-dashboard';

    // Bot Status Section
    const botStatus = document.createElement('div');
    botStatus.className = 'bot-status-container';
    botStatus.innerHTML = `
      <h3>Bot Status</h3>
      <div id="botList" class="bot-list"></div>
    `;

    // Performance Metrics Section
    const metrics = document.createElement('div');
    metrics.className = 'metrics-container';
    metrics.innerHTML = `
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
    `;

    // Control Panel Section
    const controls = document.createElement('div');
    controls.className = 'control-panel';
    controls.innerHTML = `
      <h3>Control Panel</h3>
      <div class="control-buttons">
        <button id="startBattle">Start Battle</button>
        <button id="pauseBattle">Pause</button>
        <button id="resetBattle">Reset</button>
      </div>
    `;

    dashboard.append(botStatus, metrics, controls);
    this.container.appendChild(dashboard);

    // Add event listeners
    this.setupEventListeners();
  }

  private setupEventListeners() {
    const startBtn = document.getElementById('startBattle');
    const pauseBtn = document.getElementById('pauseBattle');
    const resetBtn = document.getElementById('resetBattle');

    startBtn?.addEventListener('click', () => this.startBattle());
    pauseBtn?.addEventListener('click', () => this.pauseBattle());
    resetBtn?.addEventListener('click', () => this.resetBattle());
  }

  public updateBotStatus(bot: BotStatus) {
    this.bots.set(bot.id, bot);
    this.renderBotList();
  }

  public updateMetrics(metrics: Partial<PerformanceMetrics>) {
    Object.assign(this.metrics, metrics);
    this.renderMetrics();
  }

  private renderBotList() {
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

  private renderMetrics() {
    const execSpeed = document.getElementById('execSpeed');
    const memEfficiency = document.getElementById('memEfficiency');
    const battleProgress = document.getElementById('battleProgress');

    if (execSpeed) {
      execSpeed.textContent = `${this.metrics.executionSpeed.toFixed(1)} IPS`;
    }
    if (memEfficiency) {
      memEfficiency.textContent = `${this.metrics.memoryEfficiency.toFixed(1)}%`;
    }
    if (battleProgress) {
      battleProgress.textContent = `${this.metrics.battleProgress.toFixed(1)}%`;
    }
  }

  private startBattle() {
    // Implement battle start logic
    this.updateMetrics({ battleProgress: 0 });
    // Emit event for battle start
    this.container.dispatchEvent(new CustomEvent('battleStart'));
  }

  private pauseBattle() {
    // Implement battle pause logic
    // Emit event for battle pause
    this.container.dispatchEvent(new CustomEvent('battlePause'));
  }

  private resetBattle() {
    // Implement battle reset logic
    this.bots.clear();
    this.updateMetrics({
      executionSpeed: 0,
      memoryEfficiency: 0,
      battleProgress: 0,
    });
    this.renderBotList();
    // Emit event for battle reset
    this.container.dispatchEvent(new CustomEvent('battleReset'));
  }
}