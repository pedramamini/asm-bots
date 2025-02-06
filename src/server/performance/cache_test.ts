import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Cache, CacheManager, CACHE_CONFIG } from "./cache.ts";

Deno.test("Cache - Basic Operations", async (t) => {
  const cache = new Cache<string>({ maxSize: 100, ttl: 1000 });

  await t.step("Set and Get", () => {
    cache.set("key1", "value1");
    assertEquals(cache.get("key1"), "value1");
  });

  await t.step("Missing Key", () => {
    assertEquals(cache.get("nonexistent"), null);
  });

  await t.step("TTL Expiration", async () => {
    const shortCache = new Cache<string>({ maxSize: 10, ttl: 100 });
    shortCache.set("expire", "value");

    await new Promise(resolve => setTimeout(resolve, 150));
    assertEquals(shortCache.get("expire"), null);
  });

  await t.step("Max Size Enforcement", () => {
    const smallCache = new Cache<number>({ maxSize: 3, ttl: 1000 });

    smallCache.set("a", 1);
    smallCache.set("b", 2);
    smallCache.set("c", 3);
    smallCache.set("d", 4); // Should evict oldest

    assertEquals(smallCache.get("a"), null);
    assertExists(smallCache.get("d"));
  });
});

Deno.test("Cache - Statistics", async (t) => {
  const cache = new Cache<string>({ maxSize: 10, ttl: 1000 });

  await t.step("Hit Rate Calculation", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");

    cache.get("key1"); // hit
    cache.get("key2"); // hit
    cache.get("key3"); // miss

    const stats = cache.getStats();
    assertEquals(stats.hits, 2);
    assertEquals(stats.misses, 1);
    assertEquals(stats.hitRate, 2/3);
  });

  await t.step("Cache Usage", () => {
    const stats = cache.getStats();
    assertEquals(stats.size, 2);
    assertEquals(stats.maxSize, 10);
    assertEquals(stats.usage, 0.2);
  });
});

Deno.test("CacheManager - Multiple Caches", async (t) => {
  const manager = new CacheManager();

  await t.step("Create and Retrieve Caches", () => {
    const userCache = manager.createCache<string>("users", {
      maxSize: 1000,
      ttl: 60000,
    });

    const dataCache = manager.createCache<number>("data", {
      maxSize: 500,
      ttl: 30000,
    });

    assertExists(manager.getCache("users"));
    assertExists(manager.getCache("data"));
  });

  await t.step("Cache Operations", () => {
    const cache = manager.getCache<string>("users");
    assertExists(cache);

    cache.set("user1", "data1");
    assertEquals(cache.get("user1"), "data1");
  });

  await t.step("Overall Statistics", () => {
    const userCache = manager.getCache<string>("users");
    const dataCache = manager.getCache<number>("data");
    assertExists(userCache);
    assertExists(dataCache);

    userCache.set("test1", "value1");
    userCache.get("test1"); // hit
    userCache.get("missing"); // miss

    dataCache.set("num1", 123);
    dataCache.get("num1"); // hit
    dataCache.get("missing"); // miss

    const stats = manager.getAllStats();
    assertEquals(Object.keys(stats).length, 2);
    assertEquals(manager.getOverallHitRate(), 0.5);
  });
});

Deno.test("Cache - Default Configurations", async (t) => {
  const manager = new CacheManager();

  await t.step("Leaderboard Cache Config", () => {
    const cache = manager.createCache("leaderboard", CACHE_CONFIG.LEADERBOARD);
    assertExists(cache);

    // Test the cache with typical leaderboard data
    const leaderboardData = Array.from({ length: 100 }, (_, i) => ({
      rank: i + 1,
      userId: `user${i}`,
      score: 1000 - i,
    }));

    cache.set("global", leaderboardData);
    const retrieved = cache.get("global");
    assertExists(retrieved);
    assertEquals(retrieved.length, 100);
  });

  await t.step("User Profile Cache Config", () => {
    const cache = manager.createCache("userProfile", CACHE_CONFIG.USER_PROFILE);
    assertExists(cache);

    // Test with user profile data
    const profileData = {
      id: "user123",
      username: "testuser",
      stats: { wins: 10, losses: 5 },
    };

    cache.set("user123", profileData);
    const retrieved = cache.get("user123");
    assertExists(retrieved);
    assertEquals(retrieved.username, "testuser");
  });

  await t.step("Battle History Cache Config", () => {
    const cache = manager.createCache("battleHistory", CACHE_CONFIG.BATTLE_HISTORY);
    assertExists(cache);

    // Test with battle history data
    const battleData = Array.from({ length: 10 }, (_, i) => ({
      id: `battle${i}`,
      timestamp: Date.now() - i * 1000,
      winner: `user${i % 2}`,
    }));

    cache.set("user123_history", battleData);
    const retrieved = cache.get("user123_history");
    assertExists(retrieved);
    assertEquals(retrieved.length, 10);
  });
});