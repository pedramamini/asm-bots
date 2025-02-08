import type { Bot, BotData, Battle, BattleData, BattleEvent } from "../types";
import type {
  QueryResult,
  UserRow,
  SessionRow,
  RankingRow,
  RankingHistoryRow
} from "./schema";
import { Database } from "./database";

export interface AsyncDatabaseService {
  // Database operations
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string): Promise<void>;

  // Bot operations
  createBot(bot: Omit<BotData, "id" | "created" | "updated">): Promise<Bot>;
  getBot(id: string): Promise<Bot>;
  listBots(owner?: string): Promise<Bot[]>;
  updateBot(id: string, bot: Partial<BotData>): Promise<Bot>;
  deleteBot(id: string): Promise<void>;

  // Battle operations
  createBattle(bots: string[]): Promise<BattleData>;
  getBattle(id: string): Promise<BattleData>;
  listBattles(status?: string): Promise<BattleData[]>;
  updateBattle(id: string, battle: Partial<BattleData>): Promise<BattleData>;
  addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): Promise<void>;

  // Auth operations
  createUser(user: UserRow): Promise<QueryResult>;
  getUserById(id: string): Promise<UserRow | null>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  updateUser(id: string, updates: Partial<UserRow>): Promise<QueryResult>;
  deleteUser(id: string): Promise<QueryResult>;
  createSession(session: Omit<SessionRow, "id">): Promise<QueryResult>;
  getSessionByToken(token: string): Promise<SessionRow | null>;
  getSessionsByUserId(userId: string): Promise<SessionRow[]>;
  updateSession(id: string, updates: Partial<SessionRow>): Promise<QueryResult>;
  deleteSession(id: string): Promise<QueryResult>;
  deleteExpiredSessions(): Promise<QueryResult>;

  // Ranking operations
  getRanking(userId: string): Promise<RankingRow | null>;
  getLeaderboard(limit?: number, offset?: number): Promise<(RankingRow & { username: string })[]>;
  updateRanking(ranking: RankingRow): Promise<QueryResult>;
  addRankingHistory(history: Omit<RankingHistoryRow, 'id'>): Promise<QueryResult>;
  getRankingHistory(userId: string, limit?: number): Promise<RankingHistoryRow[]>;
  getTopPerformers(orderBy: string, limit?: number): Promise<(RankingRow & { username: string })[]>;
  getWinRate(userId: string): Promise<number>;
  getAverageScore(): Promise<number>;
  getRankPosition(userId: string): Promise<number>;
  getRecentBattles(userId: string, limit?: number): Promise<{ wins: number; losses: number }>;

  // Database operations
  close(): void;
  getDatabase(): Database;

  // Cache operations
  getCacheStats(): { [key: string]: { hits: number; misses: number; size: number } };
  getPerformanceStats(period: number): {
    queries: any;
    botOperations: any;
    battleOperations: any;
    cacheStats: { [key: string]: { hits: number; misses: number; size: number } };
  };
}