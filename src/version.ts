// Version information for ASM-Bots
// Format: YYYY.MM.DD[letter] where letter is used for multiple releases on the same day

export const VERSION = '2025.07.12a';
export const VERSION_DATE = new Date('2025-07-12');
export const VERSION_NAME = 'Enhanced Battle System';

export interface VersionInfo {
  version: string;
  date: Date;
  name: string;
  features: string[];
}

export const VERSION_INFO: VersionInfo = {
  version: VERSION,
  date: VERSION_DATE,
  name: VERSION_NAME,
  features: [
    'Random memory placement for bots',
    'Real-time memory visualization',
    'WebSocket battle updates',
    'Dark/light mode toggle',
    'Streaming battle logs',
    'Multi-bot battles'
  ]
};