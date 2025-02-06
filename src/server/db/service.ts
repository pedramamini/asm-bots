import { Database } from "./database.ts";
import { SQLiteAuthQueries } from "./auth_queries.ts";
import { SQLiteRankingQueries } from "./ranking_queries.ts";
import type { Bot, Battle, BattleEvent } from "../types.ts";
import type {
  AuthQueries,
  RankingQueries,
  DatabaseQueries,
  QueryResult,
  UserRow,
  SessionRow,
  RankingRow,
} from "./schema.ts";

export interface DatabaseService extends DatabaseQueries {
  // Bot operations
  createBot(bot: Omit<Bot, "id" | "created" | "updated">): Promise<Bot>;
  getBot(id: string): Promise<Bot>;
  listBots(owner?: string): Promise<Bot[]>;
  updateBot(id: string, bot: Partial<Bot>): Promise<Bot>;
  deleteBot(id: string): Promise<void>;

  // Battle operations
  createBattle(bots: string[]): Promise<Battle>;
  getBattle(id: string): Promise<Battle>;
  listBattles(status?: string): Promise<Battle[]>;
  updateBattle(id: string, battle: Partial<Battle>): Promise<Battle>;
  addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): Promise<void>;

  // Database operations
  close(): void;
  getDatabase(): Database;
}

export class SQLiteDatabaseService implements DatabaseService {
  private db: Database;
  private authQueries: SQLiteAuthQueries;
  private rankingQueries: SQLiteRankingQueries;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.authQueries = new SQLiteAuthQueries(this.db);
    this.rankingQueries = new SQLiteRankingQueries(this.db);
  }

  // Implement DatabaseQueries interface
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.query(sql, params);
  }

  execute(sql: string): void {
    this.db.execute(sql);
  }

  // Auth operations
  createUser = this.authQueries.createUser.bind(this.authQueries);
  getUserById = this.authQueries.getUserById.bind(this.authQueries);
  getUserByUsername = this.authQueries.getUserByUsername.bind(this.authQueries);
  getUserByEmail = this.authQueries.getUserByEmail.bind(this.authQueries);
  updateUser = this.authQueries.updateUser.bind(this.authQueries);
  deleteUser = this.authQueries.deleteUser.bind(this.authQueries);
  createSession = this.authQueries.createSession.bind(this.authQueries);
  getSessionByToken = this.authQueries.getSessionByToken.bind(this.authQueries);
  getSessionsByUserId = this.authQueries.getSessionsByUserId.bind(this.authQueries);
  updateSession = this.authQueries.updateSession.bind(this.authQueries);
  deleteSession = this.authQueries.deleteSession.bind(this.authQueries);
  deleteExpiredSessions = this.authQueries.deleteExpiredSessions.bind(this.authQueries);

  // Ranking operations
  getRanking = this.rankingQueries.getRanking.bind(this.rankingQueries);
  getLeaderboard = this.rankingQueries.getLeaderboard.bind(this.rankingQueries);
  updateRanking = this.rankingQueries.updateRanking.bind(this.rankingQueries);
  addRankingHistory = this.rankingQueries.addRankingHistory.bind(this.rankingQueries);
  getRankingHistory = this.rankingQueries.getRankingHistory.bind(this.rankingQueries);
  getTopPerformers = this.rankingQueries.getTopPerformers.bind(this.rankingQueries);
  getWinRate = this.rankingQueries.getWinRate.bind(this.rankingQueries);
  getAverageScore = this.rankingQueries.getAverageScore.bind(this.rankingQueries);
  getRankPosition = this.rankingQueries.getRankPosition.bind(this.rankingQueries);
  getRecentBattles = this.rankingQueries.getRecentBattles.bind(this.rankingQueries);

  // Bot operations
  async createBot(botData: Omit<Bot, "id" | "created" | "updated">): Promise<Bot> {
    const bot: Bot = {
      id: crypto.randomUUID(),
      ...botData,
      created: new Date(),
      updated: new Date(),
    };

    await this.db.saveBot(bot);
    const savedBot = await this.db.getBot(bot.id);
    if (!savedBot) {
      throw new Error("Failed to create bot");
    }
    return savedBot;
  }

  async getBot(id: string): Promise<Bot> {
    const bot = await this.db.getBot(id);
    if (!bot) {
      throw new Error(`Bot not found: ${id}`);
    }
    return bot;
  }

  async listBots(owner?: string): Promise<Bot[]> {
    return await this.db.listBots(owner);
  }

  async updateBot(id: string, botData: Partial<Bot>): Promise<Bot> {
    const existingBot = await this.getBot(id);
    const updatedBot: Bot = {
      ...existingBot,
      ...botData,
      id, // Ensure ID doesn't change
      updated: new Date(),
    };

    await this.db.saveBot(updatedBot);
    const savedBot = await this.db.getBot(id);
    if (!savedBot) {
      throw new Error("Failed to update bot");
    }
    return savedBot;
  }

  async deleteBot(id: string): Promise<void> {
    const success = await this.db.deleteBot(id);
    if (!success) {
      throw new Error(`Bot not found: ${id}`);
    }
  }

  // Battle operations
  async createBattle(botIds: string[]): Promise<Battle> {
    // Verify all bots exist
    await Promise.all(botIds.map(id => this.getBot(id)));

    const battle: Battle = {
      id: crypto.randomUUID(),
      bots: botIds,
      status: "pending",
      events: [],
    };

    await this.db.saveBattle(battle);
    const savedBattle = await this.db.getBattle(battle.id);
    if (!savedBattle) {
      throw new Error("Failed to create battle");
    }
    return savedBattle;
  }

  async getBattle(id: string): Promise<Battle> {
    const battle = await this.db.getBattle(id);
    if (!battle) {
      throw new Error(`Battle not found: ${id}`);
    }
    return battle;
  }

  async listBattles(status?: string): Promise<Battle[]> {
    return await this.db.listBattles(status);
  }

  async updateBattle(id: string, battleData: Partial<Battle>): Promise<Battle> {
    const existingBattle = await this.getBattle(id);
    const updatedBattle: Battle = {
      ...existingBattle,
      ...battleData,
      id, // Ensure ID doesn't change
    };

    await this.db.saveBattle(updatedBattle);
    const savedBattle = await this.db.getBattle(id);
    if (!savedBattle) {
      throw new Error("Failed to update battle");
    }
    return savedBattle;
  }

  async addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): Promise<void> {
    const battle = await this.getBattle(battleId);
    const newEvent: BattleEvent = {
      ...event,
      timestamp: Date.now(),
    };

    battle.events.push(newEvent);
    await this.db.saveBattle(battle);
  }

  // Database operations
  close(): void {
    this.db.close();
  }

  getDatabase(): Database {
    return this.db;
  }
}