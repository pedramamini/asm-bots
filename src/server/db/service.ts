import { Database } from "./database";
import { SQLiteAuthQueries } from "./auth_queries";
import { SQLiteRankingQueries } from "./ranking_queries";
import type { Bot, BotData, Battle, BattleData, BattleEvent } from "../types";
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
  createBot(bot: Omit<BotData, "id" | "created" | "updated">): Bot;
  getBot(id: string): Bot;
  listBots(owner?: string): Bot[];
  updateBot(id: string, bot: Partial<BotData>): Bot;
  deleteBot(id: string): void;

  // Battle operations
  createBattle(bots: string[]): BattleData;
  getBattle(id: string): BattleData;
  listBattles(status?: string): BattleData[];
  updateBattle(id: string, battle: Partial<BattleData>): BattleData;
  addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): void;

  // Database operations
  close(): void;
  getDatabase(): Database;
}

export class SQLiteDatabaseService implements DatabaseService {
  private createBotFromData(botData: BotData): Bot {
    return {
      ...botData,
      memory: new Uint8Array(256), // Default memory size
      pc: 0,
      cyclesExecuted: 0,
      color: '#' + Math.floor(Math.random()*16777215).toString(16), // Random color
      currentInstruction: '',
    };
  }
  private db: Database;
  private authQueries: SQLiteAuthQueries;
  private rankingQueries: SQLiteRankingQueries;

  // Auth operations
  createUser: AuthQueries['createUser'];
  getUserById: AuthQueries['getUserById'];
  getUserByUsername: AuthQueries['getUserByUsername'];
  getUserByEmail: AuthQueries['getUserByEmail'];
  updateUser: AuthQueries['updateUser'];
  deleteUser: AuthQueries['deleteUser'];
  createSession: AuthQueries['createSession'];
  getSessionByToken: AuthQueries['getSessionByToken'];
  getSessionsByUserId: AuthQueries['getSessionsByUserId'];
  updateSession: AuthQueries['updateSession'];
  deleteSession: AuthQueries['deleteSession'];
  deleteExpiredSessions: AuthQueries['deleteExpiredSessions'];

  // Ranking operations
  getRanking: RankingQueries['getRanking'];
  getLeaderboard: RankingQueries['getLeaderboard'];
  updateRanking: RankingQueries['updateRanking'];
  addRankingHistory: RankingQueries['addRankingHistory'];
  getRankingHistory: RankingQueries['getRankingHistory'];
  getTopPerformers: RankingQueries['getTopPerformers'];
  getWinRate: RankingQueries['getWinRate'];
  getAverageScore: RankingQueries['getAverageScore'];
  getRankPosition: RankingQueries['getRankPosition'];
  getRecentBattles: RankingQueries['getRecentBattles'];

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.authQueries = new SQLiteAuthQueries(this.db);
    this.rankingQueries = new SQLiteRankingQueries(this.db);

    // Initialize auth operations
    this.createUser = this.authQueries.createUser.bind(this.authQueries);
    this.getUserById = this.authQueries.getUserById.bind(this.authQueries);
    this.getUserByUsername = this.authQueries.getUserByUsername.bind(this.authQueries);
    this.getUserByEmail = this.authQueries.getUserByEmail.bind(this.authQueries);
    this.updateUser = this.authQueries.updateUser.bind(this.authQueries);
    this.deleteUser = this.authQueries.deleteUser.bind(this.authQueries);
    this.createSession = this.authQueries.createSession.bind(this.authQueries);
    this.getSessionByToken = this.authQueries.getSessionByToken.bind(this.authQueries);
    this.getSessionsByUserId = this.authQueries.getSessionsByUserId.bind(this.authQueries);
    this.updateSession = this.authQueries.updateSession.bind(this.authQueries);
    this.deleteSession = this.authQueries.deleteSession.bind(this.authQueries);
    this.deleteExpiredSessions = this.authQueries.deleteExpiredSessions.bind(this.authQueries);

    // Initialize ranking operations
    this.getRanking = this.rankingQueries.getRanking.bind(this.rankingQueries);
    this.getLeaderboard = this.rankingQueries.getLeaderboard.bind(this.rankingQueries);
    this.updateRanking = this.rankingQueries.updateRanking.bind(this.rankingQueries);
    this.addRankingHistory = this.rankingQueries.addRankingHistory.bind(this.rankingQueries);
    this.getRankingHistory = this.rankingQueries.getRankingHistory.bind(this.rankingQueries);
    this.getTopPerformers = this.rankingQueries.getTopPerformers.bind(this.rankingQueries);
    this.getWinRate = this.rankingQueries.getWinRate.bind(this.rankingQueries);
    this.getAverageScore = this.rankingQueries.getAverageScore.bind(this.rankingQueries);
    this.getRankPosition = this.rankingQueries.getRankPosition.bind(this.rankingQueries);
    this.getRecentBattles = this.rankingQueries.getRecentBattles.bind(this.rankingQueries);
  }

  // Implement DatabaseQueries interface
  query<T = unknown>(sql: string, params?: unknown[]): T[] {
    return this.db.query(sql, params);
  }

  execute(sql: string): void {
    this.db.execute(sql);
  }

  // Bot operations
  createBot(botData: Omit<BotData, "id" | "created" | "updated">): Bot {
    const bot: BotData = {
      id: crypto.randomUUID(),
      ...botData,
      created: new Date(),
      updated: new Date(),
    };

    this.db.saveBot(bot);
    const savedBot = this.db.getBot(bot.id);
    if (!savedBot) {
      throw new Error("Failed to create bot");
    }
    return this.createBotFromData(savedBot);
  }

  getBot(id: string): Bot {
    const botData = this.db.getBot(id);
    if (!botData) {
      throw new Error(`Bot not found: ${id}`);
    }
    return this.createBotFromData(botData);
  }

  listBots(owner?: string): Bot[] {
    const botDataList = this.db.listBots(owner);
    return botDataList.map(botData => this.createBotFromData(botData));
  }

  updateBot(id: string, botData: Partial<BotData>): Bot {
    const existingBotData = this.db.getBot(id);
    if (!existingBotData) {
      throw new Error(`Bot not found: ${id}`);
    }

    const updatedBotData: BotData = {
      ...existingBotData,
      ...botData,
      id, // Ensure ID doesn't change
      updated: new Date(),
    };

    this.db.saveBot(updatedBotData);
    const savedBotData = this.db.getBot(id);
    if (!savedBotData) {
      throw new Error("Failed to update bot");
    }
    return this.createBotFromData(savedBotData);
  }

  deleteBot(id: string): void {
    const success = this.db.deleteBot(id);
    if (!success) {
      throw new Error(`Bot not found: ${id}`);
    }
  }

  // Battle operations
  createBattle(botIds: string[]): BattleData {
    // Verify all bots exist
    botIds.forEach(id => this.getBot(id));

    const battle: BattleData = {
      id: crypto.randomUUID(),
      bots: botIds,
      status: "pending",
      events: [],
    };

    this.db.saveBattle(battle);
    const savedBattle = this.db.getBattle(battle.id);
    if (!savedBattle) {
      throw new Error("Failed to create battle");
    }
    return savedBattle;
  }

  getBattle(id: string): BattleData {
    const battle = this.db.getBattle(id);
    if (!battle) {
      throw new Error(`Battle not found: ${id}`);
    }
    return battle;
  }

  listBattles(status?: string): BattleData[] {
    return this.db.listBattles(status);
  }

  updateBattle(id: string, battleData: Partial<BattleData>): BattleData {
    const existingBattle = this.getBattle(id);
    const updatedBattle: BattleData = {
      ...existingBattle,
      ...battleData,
      id, // Ensure ID doesn't change
    };

    this.db.saveBattle(updatedBattle);
    const savedBattle = this.db.getBattle(id);
    if (!savedBattle) {
      throw new Error("Failed to update battle");
    }
    return savedBattle;
  }

  addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): void {
    const battle = this.getBattle(battleId);
    const newEvent: BattleEvent = {
      ...event,
      timestamp: Date.now(),
    };

    battle.events.push(newEvent);
    this.db.saveBattle(battle);
  }

  // Database operations
  close(): void {
    this.db.close();
  }

  getDatabase(): Database {
    return this.db;
  }
}