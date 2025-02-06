import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { Bot, Battle, BattleEvent } from "../types.ts";

export class Database {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new DB(dbPath);
    this.initializeTables();
  }

  private initializeTables() {
    // Bots table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        owner TEXT NOT NULL,
        created DATETIME NOT NULL,
        updated DATETIME NOT NULL
      )
    `);

    // Battles table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS battles (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        winner TEXT,
        start_time DATETIME,
        end_time DATETIME
      )
    `);

    // Battle participants table (many-to-many relationship)
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS battle_participants (
        battle_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        FOREIGN KEY (battle_id) REFERENCES battles(id),
        FOREIGN KEY (bot_id) REFERENCES bots(id),
        PRIMARY KEY (battle_id, bot_id)
      )
    `);

    // Battle events table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS battle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        battle_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data JSON NOT NULL,
        FOREIGN KEY (battle_id) REFERENCES battles(id),
        FOREIGN KEY (bot_id) REFERENCES bots(id)
      )
    `);

    // Create indexes for better query performance
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_events_battle ON battle_events(battle_id)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON battle_events(timestamp)`);
  }

  // Bot operations
  async saveBot(bot: Bot): Promise<void> {
    const query = `
      INSERT OR REPLACE INTO bots (id, name, code, owner, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await this.db.query(query, [
      bot.id,
      bot.name,
      bot.code,
      bot.owner,
      bot.created.toISOString(),
      bot.updated.toISOString(),
    ]);
  }

  async getBot(id: string): Promise<Bot | null> {
    const result = await this.db.query(
      "SELECT * FROM bots WHERE id = ?",
      [id]
    );

    if (!result.length) return null;

    const [botRow] = result;
    return {
      id: botRow[0],
      name: botRow[1],
      code: botRow[2],
      owner: botRow[3],
      created: new Date(botRow[4]),
      updated: new Date(botRow[5]),
    };
  }

  async listBots(owner?: string): Promise<Bot[]> {
    const query = owner
      ? "SELECT * FROM bots WHERE owner = ? ORDER BY created DESC"
      : "SELECT * FROM bots ORDER BY created DESC";

    const params = owner ? [owner] : [];
    const results = await this.db.query(query, params);

    return results.map((row) => ({
      id: row[0],
      name: row[1],
      code: row[2],
      owner: row[3],
      created: new Date(row[4]),
      updated: new Date(row[5]),
    }));
  }

  async deleteBot(id: string): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM bots WHERE id = ?",
      [id]
    );
    return result.length > 0;
  }

  // Battle operations
  async saveBattle(battle: Battle): Promise<void> {
    // Start a transaction
    this.db.execute("BEGIN TRANSACTION");

    try {
      // Insert battle record
      await this.db.query(
        `INSERT OR REPLACE INTO battles (id, status, winner, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battle.id,
          battle.status,
          battle.winner || null,
          battle.startTime?.toISOString() || null,
          battle.endTime?.toISOString() || null,
        ]
      );

      // Clear existing participants
      await this.db.query(
        "DELETE FROM battle_participants WHERE battle_id = ?",
        [battle.id]
      );

      // Insert participants
      for (const botId of battle.bots) {
        await this.db.query(
          "INSERT INTO battle_participants (battle_id, bot_id) VALUES (?, ?)",
          [battle.id, botId]
        );
      }

      // Save events
      for (const event of battle.events) {
        await this.db.query(
          `INSERT INTO battle_events (battle_id, bot_id, type, timestamp, data)
           VALUES (?, ?, ?, ?, ?)`,
          [
            battle.id,
            event.botId,
            event.type,
            event.timestamp,
            JSON.stringify(event.data),
          ]
        );
      }

      this.db.execute("COMMIT");
    } catch (error) {
      this.db.execute("ROLLBACK");
      throw error;
    }
  }

  async getBattle(id: string): Promise<Battle | null> {
    const battleRow = await this.db.query(
      "SELECT * FROM battles WHERE id = ?",
      [id]
    );

    if (!battleRow.length) return null;

    const [battle] = battleRow;

    // Get participants
    const participants = await this.db.query(
      "SELECT bot_id FROM battle_participants WHERE battle_id = ?",
      [id]
    );

    // Get events
    const events = await this.db.query(
      "SELECT bot_id, type, timestamp, data FROM battle_events WHERE battle_id = ? ORDER BY timestamp",
      [id]
    );

    return {
      id: battle[0],
      status: battle[1],
      winner: battle[2] || undefined,
      startTime: battle[3] ? new Date(battle[3]) : undefined,
      endTime: battle[4] ? new Date(battle[4]) : undefined,
      bots: participants.map((row) => row[0]),
      events: events.map((row) => ({
        botId: row[0],
        type: row[1],
        timestamp: row[2],
        data: JSON.parse(row[3]),
      })),
    };
  }

  async listBattles(status?: string): Promise<Battle[]> {
    const query = status
      ? "SELECT id FROM battles WHERE status = ? ORDER BY start_time DESC"
      : "SELECT id FROM battles ORDER BY start_time DESC";

    const params = status ? [status] : [];
    const results = await this.db.query(query, params);

    const battles: Battle[] = [];
    for (const [id] of results) {
      const battle = await this.getBattle(id);
      if (battle) battles.push(battle);
    }

    return battles;
  }

  // Cleanup
  close() {
    this.db.close();
  }
}