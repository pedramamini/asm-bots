import { DatabaseService } from "../db/service.ts";
import { CacheManager, CACHE_CONFIG } from "./cache.ts";
import { monitor } from "./monitor.ts";
import type { Bot, Battle, BattleEvent } from "../types.ts";
import type { UserRow, SessionRow, RankingRow } from "../db/schema.ts";

export class OptimizedDatabaseService implements DatabaseService {
  private cacheManager: CacheManager;

  constructor(private db: DatabaseService) {
    this.cacheManager = new CacheManager();
    this.initializeCaches();
  }

  private initializeCaches() {
    this.cacheManager.createCache<Bot>("bots", CACHE_CONFIG.BOT_CODE);
    this.cacheManager.createCache<Battle>("battles", CACHE_CONFIG.BATTLE_HISTORY);
    this.cacheManager.createCache<UserRow>("users", CACHE_CONFIG.USER_PROFILE);
    this.cacheManager.createCache<RankingRow[]>("rankings", CACHE_CONFIG.RANKING);
    this.cacheManager.createCache<SessionRow>("sessions", {
      maxSize: 10000,
      ttl: 15 * 60 * 1000, // 15 minutes
    });
  }

  // Database operations
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return await monitor.measureAsync("db_query", () =>
      this.db.query<T>(sql, params)
    );
  }

  execute(sql: string): void {
    monitor.measure("db_execute", () => this.db.execute(sql));
  }

  // Bot operations
  async createBot(botData: Omit<Bot, "id" | "created" | "updated">): Promise<Bot> {
    const bot = await monitor.measureAsync("db_create_bot", () =>
      this.db.createBot(botData)
    );

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.set(bot.id, bot);

    return bot;
  }

  async getBot(id: string): Promise<Bot> {
    const cache = this.cacheManager.getCache<Bot>("bots");
    const cached = cache?.get(id);
    if (cached) return cached;

    const bot = await monitor.measureAsync("db_get_bot", () =>
      this.db.getBot(id)
    );

    cache?.set(id, bot);
    return bot;
  }

  async listBots(owner?: string): Promise<Bot[]> {
    const cacheKey = `list_${owner || 'all'}`;
    const cache = this.cacheManager.getCache<Bot[]>("bots");
    const cached = cache?.get(cacheKey);
    if (cached) return cached;

    const bots = await monitor.measureAsync("db_list_bots", () =>
      this.db.listBots(owner)
    );

    cache?.set(cacheKey, bots);
    return bots;
  }

  async updateBot(id: string, bot: Partial<Bot>): Promise<Bot> {
    const updated = await monitor.measureAsync("db_update_bot", () =>
      this.db.updateBot(id, bot)
    );

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.set(id, updated);

    return updated;
  }

  async deleteBot(id: string): Promise<void> {
    await monitor.measureAsync("db_delete_bot", () =>
      this.db.deleteBot(id)
    );

    const cache = this.cacheManager.getCache<Bot>("bots");
    cache?.delete(id);
  }

  // Battle operations
  async createBattle(bots: string[]): Promise<Battle> {
    const battle = await monitor.measureAsync("db_create_battle", () =>
      this.db.createBattle(bots)
    );

    const cache = this.cacheManager.getCache<Battle>("battles");
    cache?.set(battle.id, battle);

    return battle;
  }

  async getBattle(id: string): Promise<Battle> {
    const cache = this.cacheManager.getCache<Battle>("battles");
    const cached = cache?.get(id);
    if (cached) return cached;

    const battle = await monitor.measureAsync("db_get_battle", () =>
      this.db.getBattle(id)
    );

    cache?.set(id, battle);
    return battle;
  }

  async listBattles(status?: string): Promise<Battle[]> {
    const cacheKey = `list_${status || 'all'}`;
    const cache = this.cacheManager.getCache<Battle[]>("battles");
    const cached = cache?.get(cacheKey);
    if (cached) return cached;

    const battles = await monitor.measureAsync("db_list_battles", () =>
      this.db.listBattles(status)
    );

    cache?.set(cacheKey, battles);
    return battles;
  }

  async updateBattle(id: string, battle: Partial<Battle>): Promise<Battle> {
    const updated = await monitor.measureAsync("db_update_battle", () =>
      this.db.updateBattle(id, battle)
    );

    const cache = this.cacheManager.getCache<Battle>("battles");
    cache?.set(id, updated);

    return updated;
  }

  async addBattleEvent(battleId: string, event: Omit<BattleEvent, "timestamp">): Promise<void> {
    await monitor.measureAsync("db_add_battle_event", () =>
      this.db.addBattleEvent(battleId, event)
    );

    // Invalidate battle cache since events were modified
    const cache = this.cacheManager.getCache<Battle>("battles");
    cache?.delete(battleId);
  }

  // Auth operations with caching
  async createUser(user: UserRow) {
    const result = await monitor.measureAsync("db_create_user", () =>
      this.db.createUser(user)
    );

    const cache = this.cacheManager.getCache<UserRow>("users");
    cache?.set(user.id, user);

    return result;
  }

  async getUserById(id: string) {
    const cache = this.cacheManager.getCache<UserRow>("users");
    const cached = cache?.get(id);
    if (cached) return cached;

    const user = await monitor.measureAsync("db_get_user", () =>
      this.db.getUserById(id)
    );

    if (user) cache?.set(id, user);
    return user;
  }

  // Implement remaining DatabaseService methods with similar caching pattern...

  getDatabase() {
    return this.db.getDatabase();
  }

  close(): void {
    this.db.close();
    this.cacheManager.clearAll();
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