class BattleManager {
  constructor() {
    this.ws = null;
    this.battleId = null;
    this.memoryDisplay = null;
    this.battleDashboard = null;
    this.executionLog = [];
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.ws = new WebSocket(`ws://${window.location.hostname}:8000/ws`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to battle updates immediately
      this.sendMessage('subscribe', { battleId: 'default' });
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after a delay
      setTimeout(() => this.setupWebSocket(), 5000);
    };
  }

  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'battleUpdate':
        this.handleBattleUpdate(message.data);
        break;
      case 'botUploaded':
        this.handleBotUploaded(message.data);
        break;
      case 'executionLog':
        this.handleExecutionLog(message.data);
        break;
      case 'error':
        this.handleError(message.data);
        break;
    }
  }

  handleBattleUpdate(battle) {
    if (!this.battleId) {
      this.battleId = battle.id;
    }

    // Update memory display for each bot
    battle.bots.forEach(bot => {
      // Assign a color if not already assigned
      if (!bot.color) {
        bot.color = this.getRandomColor();
      }
      this.memoryDisplay.updateBot(bot);
    });

    // Update battle dashboard
    this.battleDashboard.updateBotStatus(battle.bots);
    this.battleDashboard.updateMetrics({
      executionSpeed: battle.executionSpeed || 0,
      memoryEfficiency: battle.memoryEfficiency || 0,
      battleProgress: battle.progress || 0
    });

    // Update execution log display
    this.updateExecutionLogDisplay();
  }

  handleExecutionLog(data) {
    this.executionLog.push(data);
    this.updateExecutionLogDisplay();
  }

  updateExecutionLogDisplay() {
    const logContainer = document.getElementById('executionLog');
    if (logContainer) {
      logContainer.innerHTML = this.executionLog
        .slice(-100) // Keep last 100 entries
        .map(entry => `
          <div class="log-entry" style="color: ${entry.bot.color}">
            [${entry.bot.name}] IP: ${entry.instructionPointer} - ${entry.instruction}
          </div>
        `)
        .join('');
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }

  handleBotUploaded(data) {
    console.log(`Bot uploaded: ${data.name} (${data.botId})`);
  }

  handleError(data) {
    console.error('Error:', data.message);
    alert(data.message); // Show error in UI
  }

  sendMessage(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  startBattle() {
    this.sendMessage('startBattle', { battleId: this.battleId });
  }

  pauseBattle() {
    this.sendMessage('pauseBattle', { battleId: this.battleId });
  }

  resetBattle() {
    this.sendMessage('resetBattle', { battleId: this.battleId });
  }

  uploadBot(name, code) {
    this.sendMessage('uploadBot', { botData: { name, code } });
  }

  getRandomColor() {
    const colors = [
      '#FF4136', // Red
      '#2ECC40', // Green
      '#0074D9', // Blue
      '#FF851B', // Orange
      '#B10DC9', // Purple
      '#01FF70', // Lime
      '#7FDBFF', // Aqua
      '#F012BE', // Fuchsia
      '#39CCCC', // Teal
      '#FFDC00'  // Yellow
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const battleManager = new BattleManager();

  // Initialize components
  const canvas = document.getElementById('memoryCanvas');
  const battleDashboard = document.getElementById('battleDashboard');
  const uploadForm = document.getElementById('botUploadForm');

  if (canvas && battleDashboard) {
    battleManager.memoryDisplay = new MemoryDisplay(canvas);
    battleManager.battleDashboard = new BattleDashboard(battleDashboard);

    // Set up battle control buttons
    const startButton = document.getElementById('startBattle');
    const pauseButton = document.getElementById('pauseBattle');
    const resetButton = document.getElementById('resetBattle');

    if (startButton) startButton.addEventListener('click', () => battleManager.startBattle());
    if (pauseButton) pauseButton.addEventListener('click', () => battleManager.pauseBattle());
    if (resetButton) resetButton.addEventListener('click', () => battleManager.resetBattle());

    // Create execution log container if it doesn't exist
    if (!document.getElementById('executionLog')) {
      const logContainer = document.createElement('div');
      logContainer.id = 'executionLog';
      logContainer.style.cssText = `
        height: 200px;
        overflow-y: auto;
        background: #f8f9fa;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid #e9ecef;
        font-family: monospace;
        margin-top: 15px;
      `;
      battleDashboard.appendChild(logContainer);
    }
  }

  // Set up bot upload form
  if (uploadForm) {
    const fileInput = document.getElementById('botFile');
    const nameInput = document.getElementById('botName');
    const codeTextarea = document.getElementById('botCode');

    // Handle file upload
    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (file) {
        const code = await file.text();
        codeTextarea.value = code;
      }
    });

    // Handle form submission
    uploadForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const code = codeTextarea.value.trim();

      if (!name) {
        alert('Please enter a bot name');
        return;
      }

      if (!code) {
        alert('Please provide bot code');
        return;
      }

      battleManager.uploadBot(name, code);

      // Clear form
      nameInput.value = '';
      fileInput.value = '';
      codeTextarea.value = '';
    });
  }
});