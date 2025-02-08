import { DatabaseService } from "../db/service.ts";
import { AsyncDatabaseService } from "../db/async_service.ts";
import { CacheManager, CACHE_CONFIG } from "./cache.ts";
import { monitor } from "./monitor.ts";
import type { Bot, BotData, Battle, BattleData, BattleEvent } from "../types.ts";
import type { UserRow, SessionRow, RankingRow, QueryResult, RankingHistoryRow } from "../db/schema.ts";

export class OptimizedDatabaseService implements AsyncDatabaseService {
  private cacheManager: CacheManager;

  constructor(private db: DatabaseService) {
    this.cacheManager = new CacheManager();
    this.initializeCaches();
  }

  private initializeCaches() {
    this.cacheManager.createCache<Bot>("bots", CACHE_CONFIG.BOT_CODE);
    this.cacheManager.createCache<BattleData>("battles", CACHE_CONFIG.BATTLE_HISTORY);
    this.cacheManager.createCache<UserRow>("users", CACHE_CONFIG.USER_PROFILE);
    this.cacheManager.createCache<RankingRow[]>("rankings", CACHE_CONFIG.RANKING);
    this.cacheManager.createCache<SessionRow>("sessions", {
      maxSize: 10000,
      ttl: 15 * 60 * 1000, // 15 minutes
    });
  }

  // Database operations
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return monitor.measureAsync("db_query", async () => {
      return this.db.query<T>(sql, params);
    });
  }

  async execute(sql: string): Promise<void> {
    await monitor.measureAsync("db_execute", async () => {
      this.db.execute(sql);
    });
  }

  // Bot operations
  async createBot(botData: Omit<BotData, "id" | "created" | "updated">): Promise<Bot> {
    const bot = await monitor.measureAsync("db_create_bot", async () => {
      return this.db.createBot(botData);
    });

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.set(bot.id, bot);

    return bot;
  }

  async getBot(id: string): Promise<Bot> {
    const cache = this.cacheManager.getCache<Bot>("bots");
    const cached = cache?.get(id);
    if (cached) return cached;

    const bot = await monitor.measureAsync("db_get_bot", async () => {
      return this.db.getBot(id);
    });

    cache?.set(id, bot);
    return bot;
  }

  async listBots(owner?: string): Promise<Bot[]> {
    const cacheKey = `list_${owner || 'all'}`;
    const cache = this.cacheManager.getCache<Bot[]>("bots");
    const cached = cache?.get(cacheKey);
    if (cached) return cached;

    const bots = await monitor.measureAsync("db_list_bots", async () => {
      return this.db.listBots(owner);
    });

    cache?.set(cacheKey, bots);
    return bots;
  }

  async updateBot(id: string, bot: Partial<BotData>): Promise<Bot> {
    const updated = await monitor.measureAsync("db_update_bot", async () => {
      return this.db.updateBot(id, bot);
    });

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.set(id, updated);

    return updated;
  }

  async deleteBot(id: string): Promise<void> {
    await monitor.measureAsync("db_delete_bot", async () => {
      this.db.deleteBot(id);
    });

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.delete(id);
  }

  // Battle operations
  async createBattle(bots: string[]): Promise<BattleData> {
    const battle = await monitor.measureAsync("db_create_battle", async () => {
      return this.db.createBattle(bots);
    });

    const cache = this.cacheManager.getCache<BattleData>("battles");
    cache?.set(battle.id, battle);

    return battle;
  }

  async getBattle(id: string): Promise<BattleData> {
    const cache = this.cacheManager.getCache<BattleData>("battles");
    const cached = cache?.get(id);
    if (cached) return cached;

    const battle = await monitor.measureAsync("db_get_battle", async () => {
      return this.db.getBattle(id);
    });

    cache?.set(id, battle);
    return battle;
  }

  async listBattles(status?: string): Promise<BattleData[]> {
    const cacheKey = `list_${status || 'all'}`;
    const cache = this.cacheManager.getCache<BattleData[]>("battles");
    const cached = cache?.get(cacheKey);
    if (cached) return cached;

    const battles = await monitor.measureAsync("db_list_battles", async () => {
      return this.db.listBattles(status);
    });

    cache?.set(cacheKey, battles);
    return battles;
  }

  async updateBattle(id: string, battle: Partial<BattleData>): Promise<BattleData> {
    const updated = await monitor.measureAsync("db_update_battle", async () => {
      return this.db.updateBattle(id, battle);
    });

    const cache = this.cacheManager.getCache<BattleData>("battles");
    cache?.set(id, updated);

    return updated;
  }

  async addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): Promise<void> {
    await monitor.measureAsync("db_add_battle_event", async () => {
      this.db.addBattleEvent(battleId, event);
    });

    const cache = this.cacheManager.getCache<BattleData>("battles");
    cache?.delete(battleId);
  }

  // Auth operations
  async createUser(user: UserRow): Promise<QueryResult> {
    const result = await monitor.measureAsync("db_create_user", async () => {
      return this.db.createUser(user);
    });

    const cache = this.cacheManager.getCache<UserRow>("users");
    cache?.set(user.id, user);

    return result;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const cache = this.cacheManager.getCache<UserRow>("users");
    const cached = cache?.get(id);
    if (cached) return cached;

    const user = await monitor.measureAsync("db_get_user", async () => {
      return this.db.getUserById(id);
    });

    if (user) cache?.set(id, user);
    return user;
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    return monitor.measureAsync("db_get_user_by_username", async () => {
      return this.db.getUserByUsername(username);
    });
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    return monitor.measureAsync("db_get_user_by_email", async () => {
      return this.db.getUserByEmail(email);
    });
  }

  async updateUser(id: string, updates: Partial<UserRow>): Promise<QueryResult> {
    const result = await monitor.measureAsync("db_update_user", async () => {
      return this.db.updateUser(id, updates);
    });
    const cache = this.cacheManager.getCache<UserRow>("users");
    cache?.delete(id);
    return result;
  }

  async deleteUser(id: string): Promise<QueryResult> {
    const result = await monitor.measureAsync("db_delete_user", async () => {
      return this.db.deleteUser(id);
    });
    const cache = this.cacheManager.getCache<UserRow>("users");
    cache?.delete(id);
    return result;
  }

  async createSession(session: Omit<SessionRow, "id">): Promise<QueryResult> {
    return monitor.measureAsync("db_create_session", async () => {
      return this.db.createSession(session as SessionRow);
    });
  }

  async getSessionByToken(token: string): Promise<SessionRow | null> {
    return monitor.measureAsync("db_get_session", async () => {
      return this.db.getSessionByToken(token);
    });
  }

  async getSessionsByUserId(userId: string): Promise<SessionRow[]> {
    return monitor.measureAsync("db_get_user_sessions", async () => {
      return this.db.getSessionsByUserId(userId);
    });
  }

  async updateSession(id: string, updates: Partial<SessionRow>): Promise<QueryResult> {
    return monitor.measureAsync("db_update_session", async () => {
      return this.db.updateSession(id, updates);
    });
  }

  async deleteSession(id: string): Promise<QueryResult> {
    return monitor.measureAsync("db_delete_session", async () => {
      return this.db.deleteSession(id);
    });
  }

  async deleteExpiredSessions(): Promise<QueryResult> {
    return monitor.measureAsync("db_delete_expired_sessions", async () => {
      return this.db.deleteExpiredSessions();
    });
  }

  // Ranking operations
  async getRanking(userId: string): Promise<RankingRow | null> {
    return monitor.measureAsync("db_get_ranking", async () => {
      return this.db.getRanking(userId);
    });
  }

  async getLeaderboard(limit?: number, offset?: number): Promise<(RankingRow & { username: string })[]> {
    return monitor.measureAsync("db_get_leaderboard", async () => {
      return this.db.getLeaderboard(limit, offset);
    });
  }

  async updateRanking(ranking: RankingRow): Promise<QueryResult> {
    return monitor.measureAsync("db_update_ranking", async () => {
      return this.db.updateRanking(ranking);
    });
  }

  async addRankingHistory(history: Omit<RankingHistoryRow, "id">): Promise<QueryResult> {
    return monitor.measureAsync("db_add_ranking_history", async () => {
      return this.db.addRankingHistory(history);
    });
  }

  async getRankingHistory(userId: string, limit?: number): Promise<RankingHistoryRow[]> {
    return monitor.measureAsync("db_get_ranking_history", async () => {
      return this.db.getRankingHistory(userId, limit);
    });
  }

  async getTopPerformers(orderBy: string, limit?: number): Promise<(RankingRow & { username: string })[]> {
    return monitor.measureAsync("db_get_top_performers", async () => {
      return this.db.getTopPerformers(orderBy, limit);
    });
  }

  async getWinRate(userId: string): Promise<number> {
    return monitor.measureAsync("db_get_win_rate", async () => {
      return this.db.getWinRate(userId);
    });
  }

  async getAverageScore(): Promise<number> {
    return monitor.measureAsync("db_get_average_score", async () => {
      return this.db.getAverageScore();
    });
  }

  async getRankPosition(userId: string): Promise<number> {
    return monitor.measureAsync("db_get_rank_position", async () => {
      return this.db.getRankPosition(userId);
    });
  }

  async getRecentBattles(userId: string, limit?: number): Promise<{ wins: number; losses: number }> {
    return monitor.measureAsync("db_get_recent_battles", async () => {
      return this.db.getRecentBattles(userId, limit);
    });
  }

  // Database operations
  close(): void {
    this.db.close();
    this.cacheManager.clearAll();
  }

  getDatabase() {
    return this.db.getDatabase();
  }

  getCacheStats() {
    return this.cacheManager.getAllStats();
  }

  getPerformanceStats(period: number) {
    return {
      queries: monitor.getMetricStats("db_query", period),
      botOperations: monitor.getMetricStats("db_*_bot", period),
      battleOperations: monitor.getMetricStats("db_*_battle", period),
      cacheStats: this.getCacheStats(),
    };
  }
}