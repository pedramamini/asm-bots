/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface BattleEvent {
  timestamp: number;
  type: 'instruction' | 'memory' | 'status';
  botId: string;
  data: {
    address?: number;
    value?: number;
    instruction?: string;
    state?: string;
  };
}

interface BattleRecord {
  id: string;
  startTime: number;
  endTime: number;
  bots: Array<{
    id: string;
    name: string;
    initialMemory: Uint8Array;
  }>;
  events: BattleEvent[];
}

export class ReplaySystem {
  private currentRecord: BattleRecord | null = null;
  private isRecording = false;
  private playbackSpeed = 1;
  private currentEventIndex = 0;
  private playbackInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private container: HTMLElement) {
    this.initializeReplayUI();
  }

  private initializeReplayUI() {
    const replayContainer = document.createElement('div');
    replayContainer.className = 'replay-system';

    replayContainer.innerHTML = `
      <div class="replay-controls">
        <h3>Battle Replay</h3>
        <div class="control-buttons">
          <button id="recordBtn" class="record">⚫ Record</button>
          <button id="playBtn" disabled>▶ Play</button>
          <button id="pauseBtn" disabled>⏸ Pause</button>
          <button id="stopBtn" disabled>⏹ Stop</button>
        </div>
        <div class="playback-speed">
          <label>Speed: </label>
          <select id="speedSelect">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        </div>
        <div class="timeline">
          <input type="range" id="timelineSlider" min="0" max="100" value="0">
          <span id="timeDisplay">00:00</span>
        </div>
      </div>
      <div class="replay-actions">
        <button id="exportBtn">Export Battle</button>
        <input type="file" id="importInput" accept=".json" style="display: none">
        <button id="importBtn">Import Battle</button>
      </div>
    `;

    this.container.appendChild(replayContainer);
    this.setupEventListeners();
  }

  private setupEventListeners() {
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    const speedSelect = document.getElementById('speedSelect') as HTMLSelectElement;
    const timelineSlider = document.getElementById('timelineSlider') as HTMLInputElement;
    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
    const importInput = document.getElementById('importInput') as HTMLInputElement;

    recordBtn?.addEventListener('click', () => this.toggleRecording());
    playBtn?.addEventListener('click', () => this.startPlayback());
    pauseBtn?.addEventListener('click', () => this.pausePlayback());
    stopBtn?.addEventListener('click', () => this.stopPlayback());
    speedSelect?.addEventListener('change', (e) => {
      this.playbackSpeed = parseFloat((e.target as HTMLSelectElement).value);
    });
    timelineSlider?.addEventListener('input', (e) => {
      this.seekToPosition(parseInt((e.target as HTMLInputElement).value));
    });
    exportBtn?.addEventListener('click', () => this.exportBattle());
    importBtn?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.importBattle(file);
    });
  }

  public recordEvent(event: BattleEvent) {
    if (!this.isRecording || !this.currentRecord) return;

    this.currentRecord.events.push({
      ...event,
      timestamp: Date.now() - this.currentRecord.startTime
    });
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private startRecording() {
    this.isRecording = true;
    this.currentRecord = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      endTime: 0,
      bots: [], // Should be populated with initial bot states
      events: []
    };

    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    if (recordBtn) {
      recordBtn.textContent = '⏹ Stop Recording';
      recordBtn.classList.add('recording');
    }
  }

  private stopRecording() {
    if (!this.currentRecord) return;

    this.isRecording = false;
    this.currentRecord.endTime = Date.now();

    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    if (recordBtn) {
      recordBtn.textContent = '⚫ Record';
      recordBtn.classList.remove('recording');
    }
    if (playBtn) {
      playBtn.disabled = false;
    }
  }

  private startPlayback() {
    if (!this.currentRecord || this.playbackInterval) return;

    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;

    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;

    this.playbackInterval = setInterval(() => {
      this.playNextEvent();
    }, 1000 / this.playbackSpeed);
  }

  private playNextEvent() {
    if (!this.currentRecord || this.currentEventIndex >= this.currentRecord.events.length) {
      this.stopPlayback();
      return;
    }

    const event = this.currentRecord.events[this.currentEventIndex];
    this.emitPlaybackEvent(event);
    this.currentEventIndex++;
    this.updateTimelinePosition();
  }

  private emitPlaybackEvent(event: BattleEvent) {
    this.container.dispatchEvent(new CustomEvent('replayEvent', {
      detail: event
    }));
  }

  private pausePlayback() {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }

    const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    if (playBtn) playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
  }

  private stopPlayback() {
    this.pausePlayback();
    this.currentEventIndex = 0;
    this.updateTimelinePosition();

    const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    if (stopBtn) stopBtn.disabled = true;
  }

  private seekToPosition(position: number) {
    if (!this.currentRecord) return;

    const totalEvents = this.currentRecord.events.length;
    this.currentEventIndex = Math.floor((position / 100) * totalEvents);
    this.updateTimeDisplay();
  }

  private updateTimelinePosition() {
    if (!this.currentRecord) return;

    const slider = document.getElementById('timelineSlider') as HTMLInputElement;
    const position = (this.currentEventIndex / this.currentRecord.events.length) * 100;
    if (slider) slider.value = position.toString();
    this.updateTimeDisplay();
  }

  private updateTimeDisplay() {
    if (!this.currentRecord) return;

    const timeDisplay = document.getElementById('timeDisplay');
    const currentEvent = this.currentRecord.events[this.currentEventIndex];
    if (timeDisplay && currentEvent) {
      const seconds = Math.floor(currentEvent.timestamp / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      timeDisplay.textContent =
        `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  private async exportBattle() {
    if (!this.currentRecord) return;

    const blob = new Blob([JSON.stringify(this.currentRecord, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `battle-${this.currentRecord.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importBattle(file: File) {
    try {
      const text = await file.text();
      const record = JSON.parse(text) as BattleRecord;

      // Validate the imported record
      if (!this.isValidBattleRecord(record)) {
        throw new Error('Invalid battle record format');
      }

      this.currentRecord = record;
      this.currentEventIndex = 0;
      this.updateTimelinePosition();

      const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
      if (playBtn) playBtn.disabled = false;

    } catch (error) {
      console.error('Failed to import battle:', error);
      alert('Failed to import battle record. Invalid file format.');
    }
  }

  private isValidBattleRecord(record: any): record is BattleRecord {
    return (
      record &&
      typeof record.id === 'string' &&
      typeof record.startTime === 'number' &&
      typeof record.endTime === 'number' &&
      Array.isArray(record.bots) &&
      Array.isArray(record.events) &&
      record.events.every((event: any) =>
        typeof event.timestamp === 'number' &&
        typeof event.type === 'string' &&
        typeof event.botId === 'string' &&
        typeof event.data === 'object'
      )
    );
  }
}