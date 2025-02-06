import { WebSocketClient, WebSocketEvent, Storage } from "./types.ts";

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
      socket.onmessage = async (e) => {
        await this.handleWebSocketMessage(clientId, e.data);
      };

      socket.onclose = () => {
        this.handleDisconnect(clientId);
      };

      socket.onerror = (e) => {
        console.error(`WebSocket error:`, e);
        this.handleDisconnect(clientId);
      };
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

        default:
          console.warn(`Unknown WebSocket event type: ${event.type}`);
      }
    } catch (err) {
      console.error(`Error handling WebSocket message:`, err);
      await this.sendError(clientId, 'Invalid message format');
    }
  }

  private async handleSubscribe(client: WebSocketClient, battleId: string): Promise<void> {
    const battle = this.storage.battles.get(battleId);
    if (!battle) {
      await this.sendError(client.id, `Battle ${battleId} not found`);
      return;
    }

    client.subscriptions.add(battleId);
    await this.sendMessage(client.id, {
      type: 'battleUpdate',
      data: battle,
    });
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

    const message = JSON.stringify({
      type: 'battleUpdate',
      data: battle,
    });

    const promises: Promise<void>[] = [];

    for (const [clientId, client] of this.storage.clients) {
      if (client.subscriptions.has(battleId)) {
        promises.push(this.sendMessage(clientId, message));
      }
    }

    await Promise.all(promises);
  }

  private async sendMessage(clientId: string, message: unknown): Promise<void> {
    const client = this.storage.clients.get(clientId);
    if (!client) return;

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      await client.socket.send(messageStr);
    } catch (err) {
      console.error(`Error sending message to client ${clientId}:`, err);
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