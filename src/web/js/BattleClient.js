// WebSocket client for real-time battle updates
export class BattleClient {
  constructor(memoryViz, dashboard) {
    this.memoryViz = memoryViz;
    this.dashboard = dashboard;
    this.ws = null;
    this.battleId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.logTextarea = document.getElementById('streamingLog');
  }
  
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        
        // Send initial subscription
        this.send({
          type: 'subscribe',
          data: { events: ['battle', 'memory', 'process'] }
        });
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.connected = false;
        this.handleDisconnect();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.handleDisconnect();
    }
  }
  
  handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.dashboard.showError('Connection lost. Please refresh the page.');
    }
  }
  
  send(message) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, queuing message');
    }
  }
  
  log(message, type = 'info') {
    if (!this.logTextarea) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '[ERROR]' : '[INFO]';
    const logEntry = `${timestamp} ${prefix} ${message}\n`;
    
    this.logTextarea.value += logEntry;
    this.logTextarea.scrollTop = this.logTextarea.scrollHeight;
  }
  
  handleMessage(message) {
    // Only log important events, not every message
    if (['battle.created', 'battle.started', 'battle.ended', 'error'].includes(message.type)) {
      this.log(`Received: ${message.type}`);
    }
    
    switch (message.type) {
      case 'battle.created':
        this.handleBattleCreated(message.data);
        break;
        
      case 'battle.started':
        this.handleBattleStarted(message.data);
        break;
        
      case 'battle.paused':
        this.handleBattlePaused(message.data);
        break;
        
      case 'battle.reset':
        this.handleBattleReset(message.data);
        break;
        
      case 'battle.update':
        this.handleBattleUpdate(message.data);
        break;
        
      case 'battle.ended':
        this.handleBattleEnded(message.data);
        break;
        
      case 'memory.update':
        this.handleMemoryUpdate(message.data);
        break;
        
      case 'memory.access':
        this.handleMemoryAccess(message.data);
        break;
        
      case 'process.created':
        this.handleProcessCreated(message.data);
        break;
        
      case 'process.update':
        this.handleProcessUpdate(message.data);
        break;
        
      case 'process.terminated':
        this.handleProcessTerminated(message.data);
        break;
        
      case 'error':
        this.handleError(message.data);
        break;
        
      default:
        console.warn('Unknown message type:', message.type);
    }
  }
  
  handleBattleCreated(data) {
    this.battleId = data.battleId;
    console.log('Battle created:', data);
    this.log(`Battle created with ID: ${data.battleId}`);
    this.log(`Processes: ${data.processes.map(p => `${p.name} (ID: ${p.id})`).join(', ')}`);
    
    // Clear previous visualization
    this.memoryViz.clear();
    
    // Register processes
    data.processes.forEach((process, index) => {
      this.memoryViz.registerProcess(process.id, process.name, index);
      this.log(`Registered process: ${process.name} (ID: ${process.id}) with color index ${index}`);
    });
    
    this.dashboard.updateBattleInfo(data);
  }
  
  handleBattleStarted(data) {
    console.log('Battle started:', data);
    this.log('Battle STARTED! Execution beginning...');
    this.dashboard.setBattleStatus('running');
  }
  
  handleBattlePaused(data) {
    console.log('Battle paused:', data);
    this.log('Battle PAUSED');
    this.dashboard.setBattleStatus('paused');
  }
  
  handleBattleReset(data) {
    console.log('Battle reset:', data);
    this.log('Battle RESET - Ready to start again');
    this.dashboard.setBattleStatus('ready');
    this.memoryViz.clear();
  }
  
  handleBattleUpdate(data) {
    // Update metrics
    if (data.metrics) {
      this.dashboard.updateMetrics(data.metrics);
      
      // Only log metrics every 100 turns to avoid spam
      if (data.turn % 100 === 0) {
        this.log(`Turn ${data.turn}: Memory usage ${data.metrics.memoryUsage.toFixed(1)}%, Progress ${data.metrics.battleProgress.toFixed(1)}%`);
      }
    }
    
    // Update turn info
    if (data.turn !== undefined) {
      this.dashboard.updateTurn(data.turn);
    }
  }
  
  handleBattleEnded(data) {
    console.log('Battle ended:', data);
    const winnerText = data.winner ? `Process ${data.winner}` : 'No winner';
    const reasonText = data.reason === 'memory_footprint' ? ' (by memory footprint)' : '';
    this.log(`BATTLE ENDED! Winner: ${winnerText}${reasonText}`);
    this.dashboard.setBattleStatus('ended');
    this.dashboard.showWinner(data.winner);
    
    // Show winner modal if we have stats
    if (data.stats) {
      this.showWinnerModal(data);
    }
  }
  
  showWinnerModal(data) {
    const modal = document.getElementById('winnerModal');
    const overlay = document.getElementById('modalOverlay');
    
    if (!modal || !overlay) return;
    
    // Update modal content
    document.getElementById('winnerName').textContent = `Winner: ${data.stats.name}`;
    document.getElementById('statMemory').textContent = `${data.stats.memoryFootprint} bytes`;
    document.getElementById('statCycles').textContent = data.stats.cyclesExecuted.toLocaleString();
    document.getElementById('statPC').textContent = '0x' + data.stats.finalPC.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('statTurns').textContent = data.totalTurns.toLocaleString();
    document.getElementById('statReason').textContent = data.reason === 'memory_footprint' ? 'Largest Memory Footprint' : 'Last Bot Standing';
    
    // Show modal
    modal.classList.add('show');
    overlay.classList.add('show');
  }
  
  handleMemoryUpdate(data) {
    // Batch memory updates for efficiency
    if (data.updates) {
      data.updates.forEach(update => {
        this.memoryViz.updateMemory(update.address, update.value, update.owner);
      });
    }
    
    // Update memory ranges
    if (data.ranges) {
      data.ranges.forEach(range => {
        this.memoryViz.updateMemoryRange(range.start, range.data, range.owner);
      });
    }
  }
  
  handleMemoryAccess(data) {
    // Handle execution trails
    if (data.type === 'execute') {
      this.memoryViz.markAccess(data.address, data.type);
    }
  }
  
  handleProcessCreated(data) {
    console.log('Process created:', data);
    
    // Register new process
    const colorIndex = this.memoryViz.processMap.size;
    this.memoryViz.registerProcess(data.id, data.name, colorIndex);
    
    // Update dashboard
    this.dashboard.addProcess(data);
  }
  
  handleProcessUpdate(data) {
    // Update process PC
    if (data.pc !== undefined) {
      this.memoryViz.updateProcessPC(data.id, data.pc);
    }
    
    // Update process info in dashboard
    this.dashboard.updateProcess(data);
    
    // Log execution if instruction provided and it's meaningful
    if (data.instruction && data.instruction !== 'unknown' && data.instruction !== '') {
      this.dashboard.logExecution(data.id, data.pc, data.instruction);
      
      // Only log interesting instructions to streaming log
      if (['jmp', 'call', 'spl', 'mov', 'halt'].includes(data.instruction.toLowerCase().split(' ')[0])) {
        this.log(`Bot ${data.id} executed ${data.instruction} @ 0x${data.pc.toString(16).padStart(4, '0')}`);
      }
    }
  }
  
  handleProcessTerminated(data) {
    console.log('Process terminated:', data);
    
    this.log(`Process ${data.id} TERMINATED: ${data.reason || 'Unknown reason'}`);
    
    this.memoryViz.terminateProcess(data.id);
    this.dashboard.updateProcess({
      id: data.id,
      state: 'terminated',
      terminationReason: data.reason
    });
  }
  
  handleError(data) {
    console.error('Server error:', data);
    this.dashboard.showError(data.message || 'An error occurred');
  }
  
  // Battle control methods
  createBattle(bots) {
    this.send({
      type: 'battle.create',
      data: { bots }
    });
  }
  
  startBattle() {
    if (this.battleId) {
      this.send({
        type: 'battle.start',
        data: { battleId: this.battleId }
      });
    }
  }
  
  pauseBattle() {
    if (this.battleId) {
      this.send({
        type: 'battle.pause',
        data: { battleId: this.battleId }
      });
    }
  }
  
  resetBattle() {
    if (this.battleId) {
      this.send({
        type: 'battle.reset',
        data: { battleId: this.battleId }
      });
    }
  }
  
  stepBattle(steps = 1) {
    if (this.battleId) {
      this.send({
        type: 'battle.step',
        data: { battleId: this.battleId, steps }
      });
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}