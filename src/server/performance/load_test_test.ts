import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { LoadTester } from "./load_test.ts";

Deno.test("LoadTester - Basic Load Test", async (t) => {
  const tester = new LoadTester();

  await t.step("Small Scale Test", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 10,
      duration: 5000, // 5 seconds
      rampUpTime: 1000, // 1 second
      targetRPS: 50,
    });

    assertExists(result);
    assertEquals(result.failedRequests, 0);
    assertEquals(result.requestsPerSecond >= 50, true);
    assertEquals(result.p95ResponseTime <= 100, true);
  });

  await tester.cleanup();
});

Deno.test("LoadTester - Stress Test", async (t) => {
  const tester = new LoadTester();

  await t.step("High Concurrency Test", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 100,
      duration: 10000, // 10 seconds
      rampUpTime: 2000, // 2 seconds
      targetRPS: 500,
    });

    assertExists(result);
    assertEquals(result.failedRequests / result.totalRequests < 0.01, true);
    assertEquals(result.p99ResponseTime <= 200, true);
  });

  await t.step("Cache Performance", () => {
    const cacheStats = tester.db.getCacheStats();
    for (const [cacheName, stats] of Object.entries(cacheStats)) {
      assertEquals(stats.hitRate >= 0.8, true, `Cache ${cacheName} hit rate too low`);
    }
  });

  await tester.cleanup();
});

Deno.test("LoadTester - Resource Monitoring", async (t) => {
  const tester = new LoadTester();

  await t.step("Memory Usage", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 50,
      duration: 5000,
      rampUpTime: 1000,
      targetRPS: 200,
    });

    assertExists(result.memoryUsage);
    // Memory growth should be less than 50%
    const memoryGrowth = (result.memoryUsage.end - result.memoryUsage.start) /
                        result.memoryUsage.start;
    assertEquals(memoryGrowth <= 0.5, true);
  });

  await t.step("Response Time Distribution", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 20,
      duration: 5000,
      rampUpTime: 1000,
      targetRPS: 100,
    });

    // 95% of requests should be under 100ms
    assertEquals(result.p95ResponseTime <= 100, true);
    // 99% of requests should be under 200ms
    assertEquals(result.p99ResponseTime <= 200, true);
    // Average should be under 50ms
    assertEquals(result.averageResponseTime <= 50, true);
  });

  await tester.cleanup();
});

Deno.test("LoadTester - Error Handling", async (t) => {
  const tester = new LoadTester();

  await t.step("Error Rate Under Load", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 200,
      duration: 5000,
      rampUpTime: 1000,
      targetRPS: 1000,
    });

    // Error rate should be less than 1%
    const errorRate = result.failedRequests / result.totalRequests;
    assertEquals(errorRate <= 0.01, true);
  });

  await t.step("Resource Cleanup", async () => {
    await tester.cleanup();
    // Verify all resources are properly released
    assertEquals(tester.db.getCacheStats().size, 0);
  });
});

Deno.test("LoadTester - Performance Requirements", async (t) => {
  const tester = new LoadTester();

  await t.step("Meets SLA Requirements", async () => {
    const result = await tester.runLoadTest({
      concurrentUsers: 1000,
      duration: 30000, // 30 seconds
      rampUpTime: 5000, // 5 seconds
      targetRPS: 1000,
    });

    // Verify SLA requirements
    assertEquals(result.requestsPerSecond >= 1000, true, "Failed to meet RPS target");
    assertEquals(result.p95ResponseTime <= 100, true, "Response time too high");
    assertEquals(result.failedRequests / result.totalRequests <= 0.01, true, "Error rate too high");

    // Verify cache effectiveness
    const cacheStats = tester.db.getCacheStats();
    for (const [cacheName, stats] of Object.entries(cacheStats)) {
      assertEquals(
        stats.hitRate >= 0.8,
        true,
        `Cache ${cacheName} hit rate ${stats.hitRate} below target 0.8`
      );
    }

    // Verify memory usage
    const memoryGrowth = (result.memoryUsage.peak - result.memoryUsage.start) /
                        result.memoryUsage.start;
    assertEquals(
      memoryGrowth <= 1.0,
      true,
      `Memory growth ${memoryGrowth} exceeds 100%`
    );
  });

  await tester.cleanup();
});