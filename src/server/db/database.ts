import Database from 'better-sqlite3';
import type { Database as SQLiteDB } from 'better-sqlite3';
import { BotData, BattleData, BattleEvent } from "../types";

type BotRow = {
  id: string;
  name: string;
  code: string;
  owner: string;
  created: string;
  updated: string;
};

type BattleRow = {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed';
  winner: string | null;
  start_time: string | null;
  end_time: string | null;
};

type BattleParticipantRow = {
  battle_id: string;
  bot_id: string;
};

type BattleEventRow = {
  battle_id: string;
  bot_id: string;
  type: 'instruction' | 'memory' | 'status' | 'victory';
  timestamp: number;
  data: string;
};

export class Database {
  private db: SQLiteDB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  // Expose query and execute methods
  query<T = unknown>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(params || []) as T[];
  }

  execute(sql: string): void {
    this.db.exec(sql);
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
  saveBot(bot: BotData): void {
    const query = `
      INSERT OR REPLACE INTO bots (id, name, code, owner, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    this.query(query, [
      bot.id,
      bot.name,
      bot.code,
      bot.owner,
      bot.created.toISOString(),
      bot.updated.toISOString(),
    ]);
  }

  getBot(id: string): BotData | null {
    const result = this.query<BotRow>(
      "SELECT * FROM bots WHERE id = ?",
      [id]
    );

    if (!result.length) return null;

    const botRow = result[0];
    return {
      id: botRow.id,
      name: botRow.name,
      code: botRow.code,
      owner: botRow.owner,
      created: new Date(botRow.created),
      updated: new Date(botRow.updated),
    };
  }

  listBots(owner?: string): BotData[] {
    const query = owner
      ? "SELECT * FROM bots WHERE owner = ? ORDER BY created DESC"
      : "SELECT * FROM bots ORDER BY created DESC";

    const params = owner ? [owner] : [];
    const results = this.query<BotRow>(query, params);

    return results.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      owner: row.owner,
      created: new Date(row.created),
      updated: new Date(row.updated),
    }));
  }

  deleteBot(id: string): boolean {
    const result = this.query(
      "DELETE FROM bots WHERE id = ?",
      [id]
    );
    return result.length > 0;
  }

  // Battle operations
  saveBattle(battle: BattleData): void {
    // Start a transaction
    this.execute("BEGIN TRANSACTION");

    try {
      // Insert battle record
      this.query(
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
      this.query(
        "DELETE FROM battle_participants WHERE battle_id = ?",
        [battle.id]
      );

      // Insert participants
      for (const botId of battle.bots) {
        this.query<BattleParticipantRow>(
          "INSERT INTO battle_participants (battle_id, bot_id) VALUES (?, ?)",
          [battle.id, botId]
        );
      }

      // Save events
      for (const event of battle.events) {
        this.query<BattleEventRow>(
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

      this.execute("COMMIT");
    } catch (error) {
      this.execute("ROLLBACK");
      throw error;
    }
  }

  getBattle(id: string): BattleData | null {
    const battleRows = this.query<BattleRow>(
      "SELECT * FROM battles WHERE id = ?",
      [id]
    );

    if (!battleRows.length) return null;

    const battle = battleRows[0];

    // Get participants
    const participants = this.query<BattleParticipantRow>(
      "SELECT bot_id FROM battle_participants WHERE battle_id = ?",
      [id]
    );

    // Get events
    const events = this.query<BattleEventRow>(
      "SELECT bot_id, type, timestamp, data FROM battle_events WHERE battle_id = ? ORDER BY timestamp",
      [id]
    );

    return {
      id: battle.id,
      status: battle.status,
      winner: battle.winner || undefined,
      startTime: battle.start_time ? new Date(battle.start_time) : undefined,
      endTime: battle.end_time ? new Date(battle.end_time) : undefined,
      bots: participants.map(row => row.bot_id),
      events: events.map(row => ({
        botId: row.bot_id,
        type: row.type,
        timestamp: row.timestamp,
        data: JSON.parse(row.data),
      })),
    };
  }

  listBattles(status?: string): BattleData[] {
    const query = status
      ? "SELECT id FROM battles WHERE status = ? ORDER BY start_time DESC"
      : "SELECT id FROM battles ORDER BY start_time DESC";

    const params = status ? [status] : [];
    const results = this.query<{ id: string }>(query, params);

    const battles: BattleData[] = [];
    for (const { id } of results) {
      const battle = this.getBattle(id);
      if (battle) battles.push(battle);
    }

    return battles;
  }

  // Cleanup
  close() {
    this.db.close();
  }
}