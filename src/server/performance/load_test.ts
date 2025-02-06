import { monitor } from "./monitor.ts";
import { OptimizedDatabaseService } from "./optimized_db.ts";
import { SQLiteDatabaseService } from "../db/service.ts";
import type { Bot, Battle } from "../types.ts";

interface LoadTestConfig {
  concurrentUsers: number;
  duration: number; // milliseconds
  rampUpTime: number; // milliseconds
  targetRPS: number; // requests per second
}

interface LoadTestResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  errors: Array<{ message: string; count: number }>;
  cacheStats: Record<string, unknown>;
  memoryUsage: {
    start: number;
    end: number;
    peak: number;
  };
}

export class LoadTester {
  private db: OptimizedDatabaseService;
  private testUsers: Array<{ id: string; bot: Bot }> = [];
  private testBattles: Battle[] = [];

  constructor() {
    const baseDb = new SQLiteDatabaseService(":memory:");
    this.db = new OptimizedDatabaseService(baseDb);
  }

  private async setupTestData(userCount: number): Promise<void> {
    // Create test users and bots
    for (let i = 0; i < userCount; i++) {
      const user = await this.db.createUser({
        id: crypto.randomUUID(),
        username: `test_user_${i}`,
        email: `test${i}@example.com`,
        password_hash: "test_hash",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const bot = await this.db.createBot({
        name: `test_bot_${i}`,
        code: "MOV A, B",
        owner: user.id,
      });

      this.testUsers.push({ id: user.id, bot });
    }

    // Create some test battles
    for (let i = 0; i < userCount / 2; i++) {
      const user1 = this.testUsers[i * 2];
      const user2 = this.testUsers[i * 2 + 1];

      const battle = await this.db.createBattle([user1.bot.id, user2.bot.id]);
      this.testBattles.push(battle);
    }
  }

  private async simulateUserActions(userId: string): Promise<void> {
    const actions = [
      () => this.db.getUserById(userId),
      () => this.db.listBots(userId),
      () => this.db.listBattles(),
      () => this.db.getRanking(userId),
      () => this.db.getLeaderboard(10),
    ];

    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    await randomAction();
  }

  private async runConcurrentUsers(
    count: number,
    duration: number,
    rampUpTime: number
  ): Promise<void> {
    const startTime = Date.now();
    const users = Array.from({ length: count }, (_, i) => ({
      id: this.testUsers[i % this.testUsers.length].id,
      startDelay: (rampUpTime / count) * i,
    }));

    await Promise.all(
      users.map(async (user) => {
        // Wait for ramp-up delay
        await new Promise(resolve => setTimeout(resolve, user.startDelay));

        // Run user actions until duration is reached
        while (Date.now() - startTime < duration) {
          await this.simulateUserActions(user.id);
          // Add random delay between actions (100-300ms)
          await new Promise(resolve =>
            setTimeout(resolve, 100 + Math.random() * 200)
          );
        }
      })
    );
  }

  public async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    // Clear previous monitoring data
    monitor.clearMetrics();
    monitor.clearAlerts();

    // Setup test data
    await this.setupTestData(config.concurrentUsers * 2);

    const startMemory = performance.memory?.usedJSHeapSize || 0;
    let peakMemory = startMemory;

    // Start memory monitoring
    const memoryMonitor = setInterval(() => {
      const currentMemory = performance.memory?.usedJSHeapSize || 0;
      peakMemory = Math.max(peakMemory, currentMemory);
    }, 1000);

    // Run load test
    const startTime = Date.now();
    await this.runConcurrentUsers(
      config.concurrentUsers,
      config.duration,
      config.rampUpTime
    );
    const endTime = Date.now();

    clearInterval(memoryMonitor);
    const endMemory = performance.memory?.usedJSHeapSize || 0;

    // Collect metrics
    const metrics = monitor.getMetrics();
    const dbMetrics = metrics.filter(m => m.name.startsWith('db_'));
    const errors = new Map<string, number>();

    dbMetrics.forEach(m => {
      if (m.metadata?.error) {
        const count = errors.get(m.metadata.error as string) || 0;
        errors.set(m.metadata.error as string, count + 1);
      }
    });

    // Calculate statistics
    const responseTimes = dbMetrics.map(m => m.value).sort((a, b) => a - b);
    const totalRequests = responseTimes.length;
    const failedRequests = Array.from(errors.values()).reduce((a, b) => a + b, 0);

    const result: LoadTestResult = {
      totalRequests,
      successfulRequests: totalRequests - failedRequests,
      failedRequests,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / totalRequests,
      p95ResponseTime: responseTimes[Math.floor(totalRequests * 0.95)],
      p99ResponseTime: responseTimes[Math.floor(totalRequests * 0.99)],
      requestsPerSecond: totalRequests / ((endTime - startTime) / 1000),
      errors: Array.from(errors.entries()).map(([message, count]) => ({
        message,
        count,
      })),
      cacheStats: this.db.getCacheStats(),
      memoryUsage: {
        start: startMemory,
        end: endMemory,
        peak: peakMemory,
      },
    };

    // Validate against requirements
    const alerts = [];
    if (result.requestsPerSecond < config.targetRPS) {
      alerts.push(`Failed to meet target RPS: ${result.requestsPerSecond} < ${config.targetRPS}`);
    }
    if (result.p95ResponseTime > 100) {
      alerts.push(`Response time P95 too high: ${result.p95ResponseTime}ms > 100ms`);
    }
    if (result.failedRequests / result.totalRequests > 0.01) {
      alerts.push(`Error rate too high: ${(result.failedRequests / result.totalRequests * 100).toFixed(2)}% > 1%`);
    }

    if (alerts.length > 0) {
      console.error("Load test alerts:", alerts);
    }

    return result;
  }

  public async cleanup(): Promise<void> {
    await this.db.close();
  }
}