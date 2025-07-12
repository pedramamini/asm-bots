
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

// Import the new modules dynamically
let MemoryVisualization, BattleClient, Dashboard;

async function loadModules() {
  try {
    const memVizModule = await import('./js/MemoryVisualization.js');
    const battleClientModule = await import('./js/BattleClient.js');
    const dashboardModule = await import('./js/Dashboard.js');
    
    MemoryVisualization = memVizModule.MemoryVisualization;
    BattleClient = battleClientModule.BattleClient;
    Dashboard = dashboardModule.Dashboard;
    
    return true;
  } catch (error) {
    console.error('Failed to load modules:', error);
    return false;
  }
}

// Function to fetch and display version
async function fetchVersion() {
  try {
    const response = await fetch('/api/version');
    const data = await response.json();
    if (data.success && data.data) {
      const versionElement = document.getElementById('versionInfo');
      if (versionElement) {
        versionElement.textContent = `v${data.data.version}`;
        versionElement.title = `${data.data.name} - ${new Date(data.data.date).toLocaleDateString()}`;
      }
    }
  } catch (error) {
    console.error('Failed to fetch version:', error);
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing application...');
  
  // Fetch and display version
  fetchVersion();
  
  // Load modules first
  const modulesLoaded = await loadModules();
  if (!modulesLoaded) {
    console.error('Failed to load required modules');
    return;
  }
  
  const canvas = document.getElementById('memoryCanvas');
  const battleDashboard = document.getElementById('battleDashboard');
  const botManager = new BotManager();
  
  // Make botManager globally accessible first
  window.botManager = botManager;

  if (canvas) {
    console.log('Found required elements, creating components...');
    
    // Initialize new enhanced components
    const memoryViz = new MemoryVisualization(canvas);
    const dashboard = new Dashboard();
    const battleClient = new BattleClient(memoryViz, dashboard);
    
    // Connect dashboard to battle client
    dashboard.setBattleClient(battleClient);
    
    // Start memory animation
    memoryViz.startAnimation();
    
    // Set up pixel size slider
    const pixelSizeSlider = document.getElementById('pixelSizeSlider');
    const pixelSizeValue = document.getElementById('pixelSizeValue');
    const pixelSizeValue2 = document.getElementById('pixelSizeValue2');
    
    if (pixelSizeSlider) {
      pixelSizeSlider.addEventListener('input', (e) => {
        const newSize = parseInt(e.target.value);
        pixelSizeValue.textContent = newSize;
        pixelSizeValue2.textContent = newSize;
        memoryViz.setCellSize(newSize);
      });
    }
    
    // Connect to server
    battleClient.connect();

    // Set up the drag and drop functionality
    setupDragAndDrop(botManager);
    
    // Set up manual bot entry
    setupManualEntry(botManager);
    
    // Set up battle creation with new system
    setupEnhancedBattleCreation(botManager, battleClient);
    
    // Store references for global access
    window.memoryViz = memoryViz;
    window.dashboard = dashboard;
    window.battleClient = battleClient;
  } else {
    console.error('Required elements not found:', { canvas });
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
    console.log('File input changed, files:', this.files.length);
    handleFiles(this.files);
  });
  
  function handleFiles(files) {
    console.log('handleFiles called with', files.length, 'files');
    if (files.length === 0) return;
    
    Array.from(files).forEach(file => {
      console.log('Processing file:', file.name);
      if (file.name.endsWith('.asm') || file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const code = e.target.result;
          console.log('File loaded:', file.name, 'code length:', code.length);
          // Extract bot name from filename (remove extension)
          const botName = file.name.replace(/\.(asm|txt)$/, '');
          const bot = botManager.addBot(botName, code, file.size);
          console.log('Bot added:', bot);
          displayBot(bot);
          updateCreateBattleButton();
        };
        reader.onerror = function(e) {
          console.error('Error reading file:', file.name, e);
        };
        reader.readAsText(file);
      } else {
        console.log('Skipping non-.asm/.txt file:', file.name);
      }
    });
  }
  
  // Make the dropZone clickable to trigger file input
  dropZone.addEventListener('click', (e) => {
    // Don't trigger if clicking on the label or file input
    if (e.target.tagName === 'LABEL' || e.target.tagName === 'INPUT') {
      return;
    }
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

// Set up enhanced battle creation and controls
function setupEnhancedBattleCreation(botManager, battleClient) {
  const createBattleButton = document.getElementById('createBattle');
  const startBattleButton = document.getElementById('startBattle');
  const pauseBattleButton = document.getElementById('pauseBattle');
  const resetBattleButton = document.getElementById('resetBattle');
  
  if (!createBattleButton) return;
  
  createBattleButton.addEventListener('click', async () => {
    const bots = botManager.getBots();
    if (bots.length < 2) {
      window.dashboard.showError('You need at least 2 bots to create a battle.');
      return;
    }
    
    try {
      // Create bot data to send to API
      const botData = bots.map(bot => ({
        name: bot.name,
        code: bot.code,
        owner: 'Player'
      }));
      
      // Create battle via WebSocket
      battleClient.createBattle(botData);
      
      // Clear uploaded bots
      botManager.clearBots();
      const uploadedBotsContainer = document.getElementById('uploadedBots');
      if (uploadedBotsContainer) {
        uploadedBotsContainer.innerHTML = '';
      }
      updateCreateBattleButton();
      
      // Scroll to battle section
      document.querySelector('.battle-section').scrollIntoView({ 
        behavior: 'smooth' 
      });
      
    } catch (error) {
      console.error('Error creating battle:', error);
      window.dashboard.showError('Error creating battle. Check console for details.');
    }
  });
  
  // Set up start battle button
  if (startBattleButton) {
    startBattleButton.addEventListener('click', () => {
      // Check if button text is "Resume" to handle resume action
      if (startBattleButton.textContent === 'Resume') {
        battleClient.startBattle(); // Resume is just starting again
      } else {
        battleClient.startBattle();
      }
    });
  }
  
  // Set up pause battle button
  if (pauseBattleButton) {
    pauseBattleButton.addEventListener('click', () => {
      battleClient.pauseBattle();
    });
  }
  
  // Set up reset battle button
  if (resetBattleButton) {
    resetBattleButton.addEventListener('click', () => {
      battleClient.resetBattle();
    });
  }
}