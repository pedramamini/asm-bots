// Battle dashboard for controls and statistics
export class Dashboard {
  constructor() {
    this.processes = new Map();
    this.metrics = {
      turn: 0,
      cyclesPerSecond: 0,
      memoryUsage: 0,
      activeProcesses: 0
    };
    this.executionLog = [];
    this.maxLogEntries = 100;
    
    this.initializeElements();
  }
  
  initializeElements() {
    // Get DOM elements
    this.elements = {
      botList: document.getElementById('botList'),
      executionSpeed: document.getElementById('executionSpeed'),
      memoryEfficiency: document.getElementById('memoryEfficiency'),
      battleProgress: document.getElementById('battleProgress'),
      executionLog: document.getElementById('executionLog'),
      startBtn: document.getElementById('startBattle'),
      pauseBtn: document.getElementById('pauseBattle'),
      resetBtn: document.getElementById('resetBattle'),
      botLegend: document.getElementById('botLegend')
    };
    
    // Store reference to battleClient when it's set
    this.battleClient = null;
  }
  
  setBattleClient(battleClient) {
    this.battleClient = battleClient;
    
    // Set up button event listeners
    if (this.elements.startBtn) {
      this.elements.startBtn.addEventListener('click', () => {
        if (this.battleClient) {
          this.battleClient.startBattle();
        }
      });
    }
    
    if (this.elements.pauseBtn) {
      this.elements.pauseBtn.addEventListener('click', () => {
        if (this.battleClient) {
          this.battleClient.pauseBattle();
        }
      });
    }
    
    if (this.elements.resetBtn) {
      this.elements.resetBtn.addEventListener('click', () => {
        if (this.battleClient) {
          this.battleClient.resetBattle();
        }
      });
    }
  }
  
  updateBattleInfo(info) {
    // Clear existing bot list
    this.processes.clear();
    this.elements.botList.innerHTML = '';
    this.elements.botLegend.innerHTML = '';
    
    // Add processes
    info.processes.forEach((process, index) => {
      this.addProcess({
        id: process.id,
        name: process.name,
        owner: process.owner,
        state: 'ready',
        colorIndex: index
      });
    });
  }
  
  addProcess(processInfo) {
    this.processes.set(processInfo.id, processInfo);
    
    // Add to bot list
    const botElement = document.createElement('div');
    botElement.className = 'bot-item waiting';
    botElement.id = `bot-${processInfo.id}`;
    const color = this.getProcessColor(processInfo.colorIndex);
    botElement.style.borderLeftColor = color;
    botElement.innerHTML = `
      <div class="bot-header">
        <strong>${processInfo.name}</strong>
        <span class="bot-state">Ready</span>
      </div>
      <div class="bot-details">
        <div>Owner: ${processInfo.owner}</div>
        <div>PC: <span class="bot-pc">0x0000</span></div>
        <div>Cycles: <span class="bot-cycles">0</span></div>
        <div>Memory: <span class="bot-memory">0 bytes</span></div>
      </div>
    `;
    this.elements.botList.appendChild(botElement);
    
    // Add to legend
    const legendItem = document.createElement('div');
    legendItem.className = 'memory-legend-item';
    legendItem.innerHTML = `
      <div class="memory-legend-color" style="background: ${color}"></div>
      <span>${processInfo.name} (${processInfo.owner})</span>
    `;
    this.elements.botLegend.appendChild(legendItem);
  }
  
  updateProcess(processData) {
    const process = this.processes.get(processData.id);
    if (!process) return;
    
    // Update process data
    Object.assign(process, processData);
    
    // Update DOM
    const botElement = document.getElementById(`bot-${processData.id}`);
    if (!botElement) return;
    
    // Update state class
    if (processData.state) {
      botElement.className = `bot-item ${this.getStateClass(processData.state)}`;
      const stateElement = botElement.querySelector('.bot-state');
      if (stateElement) {
        stateElement.textContent = this.formatState(processData.state);
      }
    }
    
    // Update PC
    if (processData.pc !== undefined) {
      const pcElement = botElement.querySelector('.bot-pc');
      if (pcElement) {
        pcElement.textContent = '0x' + processData.pc.toString(16).padStart(4, '0').toUpperCase();
      }
    }
    
    // Update cycles
    if (processData.cycles !== undefined) {
      const cyclesElement = botElement.querySelector('.bot-cycles');
      if (cyclesElement) {
        cyclesElement.textContent = processData.cycles;
      }
    }
    
    // Update memory footprint
    if (processData.memoryFootprint !== undefined) {
      const memoryElement = botElement.querySelector('.bot-memory');
      if (memoryElement) {
        memoryElement.textContent = `${processData.memoryFootprint} bytes`;
      }
    }
  }
  
  getStateClass(state) {
    switch (state) {
      case 'running': return 'running';
      case 'ready': return 'waiting';
      case 'blocked': return 'waiting';
      case 'terminated': return 'terminated';
      default: return 'waiting';
    }
  }
  
  formatState(state) {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }
  
  getProcessColor(index) {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F8B500'
    ];
    return colors[index % colors.length];
  }
  
  updateMetrics(metrics) {
    Object.assign(this.metrics, metrics);
    
    // Update display
    if (metrics.cyclesPerSecond !== undefined) {
      this.elements.executionSpeed.textContent = 
        metrics.cyclesPerSecond > 1000 
          ? `${(metrics.cyclesPerSecond / 1000).toFixed(1)}K IPS`
          : `${metrics.cyclesPerSecond} IPS`;
    }
    
    if (metrics.memoryUsage !== undefined) {
      this.elements.memoryEfficiency.textContent = `${metrics.memoryUsage.toFixed(1)}%`;
    }
    
    if (metrics.battleProgress !== undefined) {
      this.elements.battleProgress.textContent = `${metrics.battleProgress.toFixed(1)}%`;
    }
  }
  
  updateTurn(turn) {
    this.metrics.turn = turn;
    // Could add turn display if needed
  }
  
  logExecution(processId, pc, instruction) {
    const process = this.processes.get(processId);
    if (!process) return;
    
    const logEntry = {
      time: Date.now(),
      processId,
      processName: process.name,
      pc,
      instruction
    };
    
    this.executionLog.unshift(logEntry);
    
    // Limit log size
    if (this.executionLog.length > this.maxLogEntries) {
      this.executionLog.pop();
    }
    
    // Update display
    this.renderExecutionLog();
  }
  
  renderExecutionLog() {
    const logHtml = this.executionLog.slice(0, 20).map(entry => {
      const pc = '0x' + entry.pc.toString(16).padStart(4, '0').toUpperCase();
      return `<div class="log-entry">
        [${entry.processName}] ${pc}: ${entry.instruction}
      </div>`;
    }).join('');
    
    this.elements.executionLog.innerHTML = logHtml;
  }
  
  setBattleStatus(status) {
    // Update button states
    switch (status) {
      case 'ready':
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.textContent = 'Start Battle';
        this.elements.pauseBtn.disabled = true;
        this.elements.resetBtn.disabled = true;
        
        // Clear execution log on reset
        if (this.elements.executionLog) {
          this.elements.executionLog.innerHTML = '';
        }
        this.executionLog = [];
        break;
        
      case 'running':
        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Start Battle';
        this.elements.pauseBtn.disabled = false;
        this.elements.resetBtn.disabled = false;
        break;
        
      case 'paused':
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.textContent = 'Resume';
        this.elements.pauseBtn.disabled = true;
        this.elements.resetBtn.disabled = false;
        break;
        
      case 'ended':
        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Start Battle';
        this.elements.pauseBtn.disabled = true;
        this.elements.resetBtn.disabled = false;
        break;
    }
  }
  
  showWinner(winnerId) {
    const process = this.processes.get(winnerId);
    if (process) {
      this.showMessage(`🏆 Winner: ${process.name} (${process.owner})`, 'success');
    }
  }
  
  showError(message) {
    this.showMessage(message, 'error');
  }
  
  showMessage(message, type = 'info') {
    // Create or update message element
    let messageEl = document.getElementById('dashboardMessage');
    if (!messageEl) {
      messageEl = document.createElement('div');
      messageEl.id = 'dashboardMessage';
      messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 4px;
        font-weight: 500;
        z-index: 1000;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(messageEl);
    }
    
    // Set style based on type
    const styles = {
      info: 'background: #007bff; color: white;',
      success: 'background: #28a745; color: white;',
      error: 'background: #dc3545; color: white;',
      warning: 'background: #ffc107; color: #212529;'
    };
    
    messageEl.style.cssText += styles[type] || styles.info;
    messageEl.textContent = message;
    messageEl.style.opacity = '1';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      messageEl.style.opacity = '0';
    }, 5000);
  }
  
  clear() {
    this.processes.clear();
    this.executionLog = [];
    this.elements.botList.innerHTML = '';
    this.elements.executionLog.innerHTML = '';
    this.elements.botLegend.innerHTML = '';
    this.updateMetrics({
      cyclesPerSecond: 0,
      memoryUsage: 0,
      battleProgress: 0
    });
  }
}