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

// Bot management class
class BotManager {
  constructor() {
    this.bots = new Map(); // Store uploaded bots
    this.nextId = 1;
  }

  addBot(name, code, size = null) {
    const botId = `bot_${this.nextId++}`;
    const bot = {
      id: botId,
      name: name,
      code: code,
      size: size || code.length,
      uploadTime: new Date()
    };
    this.bots.set(botId, bot);
    return bot;
  }

  removeBot(botId) {
    return this.bots.delete(botId);
  }

  clearBots() {
    this.bots.clear();
    this.nextId = 1;
  }

  getBots() {
    return Array.from(this.bots.values());
  }

  getBotCount() {
    return this.bots.size;
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing application...');
  const canvas = document.getElementById('memoryCanvas');
  const battleDashboard = document.getElementById('battleDashboard');
  const botManager = new BotManager();

  if (canvas && battleDashboard) {
    console.log('Found required elements, creating components...');
    const display = new MemoryDisplay(canvas);
    const dashboard = new BattleDashboard(battleDashboard);

    // Set up the drag and drop functionality
    setupDragAndDrop(botManager);
    
    // Set up manual bot entry
    setupManualEntry(botManager);
    
    // Set up battle creation
    setupBattleCreation(botManager, display, dashboard);

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

// Set up drag and drop functionality
function setupDragAndDrop(botManager) {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('botFiles');
  
  if (!dropZone || !fileInput) return;
  
  // Handle drag events
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Highlight drop zone when file is dragged over it
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });
  
  function highlight() {
    dropZone.classList.add('highlight');
  }
  
  function unhighlight() {
    dropZone.classList.remove('highlight');
  }
  
  // Handle dropped files
  dropZone.addEventListener('drop', handleDrop, false);
  
  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
  }
  
  // Handle files from the file input
  fileInput.addEventListener('change', function() {
    handleFiles(this.files);
  });
  
  function handleFiles(files) {
    if (files.length === 0) return;
    
    Array.from(files).forEach(file => {
      if (file.name.endsWith('.asm') || file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const code = e.target.result;
          // Extract bot name from filename (remove extension)
          const botName = file.name.replace(/\.(asm|txt)$/, '');
          const bot = botManager.addBot(botName, code, file.size);
          displayBot(bot);
          updateCreateBattleButton();
        };
        reader.readAsText(file);
      }
    });
  }
  
  // Make the dropZone clickable to trigger file input
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });
}

// Set up manual bot entry
function setupManualEntry(botManager) {
  const botNameInput = document.getElementById('botName');
  const botCodeInput = document.getElementById('botCode');
  const addButton = document.getElementById('addManualBot');
  const clearButton = document.getElementById('clearBots');
  
  if (!botNameInput || !botCodeInput || !addButton || !clearButton) return;
  
  addButton.addEventListener('click', () => {
    const name = botNameInput.value.trim();
    const code = botCodeInput.value.trim();
    
    if (name && code) {
      const bot = botManager.addBot(name, code);
      displayBot(bot);
      
      // Clear input fields
      botNameInput.value = '';
      botCodeInput.value = '';
      
      updateCreateBattleButton();
    } else {
      alert('Please enter a bot name and code.');
    }
  });
  
  clearButton.addEventListener('click', () => {
    botManager.clearBots();
    const uploadedBotsContainer = document.getElementById('uploadedBots');
    if (uploadedBotsContainer) {
      uploadedBotsContainer.innerHTML = '';
    }
    updateCreateBattleButton();
  });
}

// Display a bot in the UI
function displayBot(bot) {
  const uploadedBotsContainer = document.getElementById('uploadedBots');
  if (!uploadedBotsContainer) return;
  
  const botCard = document.createElement('div');
  botCard.className = 'bot-card';
  botCard.dataset.botId = bot.id;
  
  botCard.innerHTML = `
    <h4>${bot.name}</h4>
    <div class="bot-info">
      <div>Size: ${formatSize(bot.size)}</div>
      <div>Uploaded: ${formatTime(bot.uploadTime)}</div>
    </div>
    <button class="remove-bot" title="Remove bot">×</button>
  `;
  
  // Add remove functionality
  const removeButton = botCard.querySelector('.remove-bot');
  removeButton.addEventListener('click', () => {
    if (window.botManager.removeBot(bot.id)) {
      botCard.remove();
      updateCreateBattleButton();
    }
  });
  
  uploadedBotsContainer.appendChild(botCard);
}

// Helper for formatting file size
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  return (bytes / 1024).toFixed(1) + ' KB';
}

// Helper for formatting time
function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Set up battle creation
function setupBattleCreation(botManager, display, dashboard) {
  const createBattleButton = document.getElementById('createBattle');
  
  if (!createBattleButton) return;
  
  window.botManager = botManager; // Make available globally for event handlers
  
  createBattleButton.addEventListener('click', () => {
    const bots = botManager.getBots();
    if (bots.length < 2) {
      alert('You need at least 2 bots to create a battle.');
      return;
    }
    
    // Create the battle
    createBattle(bots, display, dashboard);
  });
}

// Update the Create Battle button state
function updateCreateBattleButton() {
  const createBattleButton = document.getElementById('createBattle');
  if (!createBattleButton) return;
  
  const botCount = window.botManager.getBotCount();
  createBattleButton.disabled = botCount < 2;
  
  // Update button text
  if (botCount < 2) {
    createBattleButton.textContent = `Need ${2 - botCount} more bot${botCount === 1 ? '' : 's'}`;
  } else {
    createBattleButton.textContent = `Create Battle with ${botCount} Bots`;
  }
}

// Create a battle with the selected bots
function createBattle(bots, display, dashboard) {
  console.log('Creating battle with bots:', bots);
  
  // Create bot data to send to API
  const botData = bots.map(bot => ({
    name: bot.name,
    code: bot.code
  }));
  
  // First, create the bots via the API
  Promise.all(botData.map(bot => 
    fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bot)
    }).then(response => response.json())
  ))
  .then(results => {
    // Extract the bot IDs from the results
    const botIds = results.map(result => result.data.id);
    
    // Now create a battle with these bots
    return fetch('/api/battles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bots: botIds })
    });
  })
  .then(response => response.json())
  .then(battleData => {
    console.log('Battle created:', battleData);
    // Scroll to battle section
    document.querySelector('.battle-section').scrollIntoView({ 
      behavior: 'smooth' 
    });
    
    // Start the battle automatically
    if (battleData.success && battleData.data.id) {
      setTimeout(() => {
        fetch(`/api/battles/${battleData.data.id}/start`, {
          method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
          console.log('Battle started:', data);
        })
        .catch(error => {
          console.error('Error starting battle:', error);
        });
      }, 1000);
    }
  })
  .catch(error => {
    console.error('Error creating battle:', error);
    alert('Error creating battle. Check console for details.');
  });
}