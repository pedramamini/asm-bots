import { WebSocket } from 'ws';
import { WebSocketClient, WebSocketEvent, Storage } from "./types.js";

export class WebSocketServer {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async handleConnection(socket: WebSocket): Promise<void> {
    const clientId = crypto.randomUUID();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
    };

    this.storage.clients.set(clientId, client);

    try {
      socket.on('message', async (data) => {
        await this.handleWebSocketMessage(clientId, data.toString());
      });

      socket.on('close', () => {
        this.handleDisconnect(clientId);
      });

      socket.on('error', (e) => {
        console.error(`WebSocket error:`, e);
        this.handleDisconnect(clientId);
      });
    } catch (err) {
      console.error(`WebSocket error:`, err);
      this.handleDisconnect(clientId);
    }
  }

  private async handleWebSocketMessage(clientId: string, message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as WebSocketEvent;
      const client = this.storage.clients.get(clientId);

      if (!client) {
        console.error(`Client ${clientId} not found`);
        return;
      }

      switch (event.type) {
        case 'subscribe':
          if (event.battleId) {
            await this.handleSubscribe(client, event.battleId);
          }
          break;

        case 'unsubscribe':
          if (event.battleId) {
            await this.handleUnsubscribe(client, event.battleId);
          }
          break;

        case 'startBattle':
          if (event.battleId) {
            await this.handleStartBattle(event.battleId);
          }
          break;

        case 'pauseBattle':
          if (event.battleId) {
            await this.handlePauseBattle(event.battleId);
          }
          break;

        case 'resetBattle':
          if (event.battleId) {
            await this.handleResetBattle(event.battleId);
          }
          break;

        case 'uploadBot':
          if (event.botData) {
            await this.handleBotUpload(client.id, event.botData);
          }
          break;

        default:
          console.warn(`Unknown WebSocket event type: ${event.type}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error(`Error handling WebSocket message:`, errorMessage);
      await this.sendError(clientId, errorMessage);
    }
  }

  private async handleStartBattle(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    battle.start();
    await this.broadcastBattleUpdate(battleId);
  }

  private async handlePauseBattle(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    battle.pause();
    await this.broadcastBattleUpdate(battleId);
  }

  private async handleResetBattle(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      console.error(`Battle ${battleId} not found`);
      return;
    }

    battle.reset();
    await this.broadcastBattleUpdate(battleId);
  }

  private async handleBotUpload(clientId: string, botData: { name: string; code: string }): Promise<void> {
    try {
      // Create a new process for the bot
      const processId = await this.storage.createProcess(botData.code, botData.name);

      // Add process to default battle
      const battle = this.storage.battles.get('default');
      if (battle) {
        battle.addProcess(processId);
      }

      // Send confirmation to client
      await this.sendMessage(clientId, {
        type: 'botUploaded',
        data: {
          botId: processId,
          name: botData.name
        }
      });

      // Broadcast battle update to all subscribers
      await this.broadcastBattleUpdate('default');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload bot';
      await this.sendError(clientId, errorMessage);
    }
  }

  private async handleSubscribe(client: WebSocketClient, battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      await this.sendError(client.id, `Battle ${battleId} not found`);
      return;
    }

    client.subscriptions.add(battleId);

    // Send initial state
    await this.sendMessage(client.id, {
      type: 'battleUpdate',
      data: battle.getState()
    });

    // Send execution logs if any
    const logs = battle.getState().logs;
    if (logs.length > 0) {
      await this.sendMessage(client.id, {
        type: 'executionLog',
        data: logs
      });
    }
  }

  private async handleUnsubscribe(client: WebSocketClient, battleId: string): Promise<void> {
    client.subscriptions.delete(battleId);
  }

  private handleDisconnect(clientId: string): void {
    const client = this.storage.clients.get(clientId);
    if (client) {
      client.socket.close();
      this.storage.clients.delete(clientId);
    }
  }

  async broadcastBattleUpdate(battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) return;

    const battleState = battle.getState();
    const battleUpdate = {
      type: 'battleUpdate',
      data: battleState
    };

    const executionLogUpdate = {
      type: 'executionLog',
      data: battleState.logs
    };

    const promises: Promise<void>[] = [];

    for (const [clientId, client] of this.storage.clients) {
      if (client.subscriptions.has(battleId)) {
        promises.push(
          this.sendMessage(clientId, battleUpdate),
          this.sendMessage(clientId, executionLogUpdate)
        );
      }
    }

    await Promise.all(promises);
  }

  private async sendMessage(clientId: string, message: unknown): Promise<void> {
    const client = this.storage.clients.get(clientId);
    if (!client) return;

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      client.socket.send(messageStr);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error sending message';
      console.error(`Error sending message to client ${clientId}:`, errorMessage);
      this.handleDisconnect(clientId);
    }
  }

  private async sendError(clientId: string, message: string): Promise<void> {
    await this.sendMessage(clientId, {
      type: 'error',
      data: { message },
    });
  }
}