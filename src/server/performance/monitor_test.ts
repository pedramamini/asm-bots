import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { PerformanceMonitor } from "./monitor.ts";

Deno.test("PerformanceMonitor - Metric Recording", async (t) => {
  const monitor = new PerformanceMonitor();

  await t.step("Record and Retrieve Metrics", () => {
    monitor.recordMetric("test_metric", 100);
    const metrics = monitor.getMetrics("test_metric");

    assertEquals(metrics.length, 1);
    assertEquals(metrics[0].name, "test_metric");
    assertEquals(metrics[0].value, 100);
  });

  await t.step("Threshold Alerts", () => {
    monitor.setThreshold("response_time", { warning: 100, error: 200 });
    monitor.recordMetric("response_time", 150);
    monitor.recordMetric("response_time", 250);

    const alerts = monitor.getAlerts();
    assertEquals(alerts.length, 2);
    assertEquals(alerts[0].type, "warning");
    assertEquals(alerts[1].type, "error");
  });

  await t.step("Metric Stats Calculation", () => {
    monitor.clearMetrics();

    // Record some test metrics
    for (let i = 1; i <= 100; i++) {
      monitor.recordMetric("perf_test", i);
    }

    const stats = monitor.getMetricStats("perf_test", 60000);
    assertEquals(stats.min, 1);
    assertEquals(stats.max, 100);
    assertEquals(stats.avg, 50.5);
    assertEquals(stats.count, 100);
    assertEquals(stats.p95, 95);
    assertEquals(stats.p99, 99);
  });
});

Deno.test("PerformanceMonitor - Performance Measurement", async (t) => {
  const monitor = new PerformanceMonitor();

  await t.step("Measure Sync Function", () => {
    const result = monitor.measure("sync_test", () => {
      let sum = 0;
      for (let i = 0; i < 1000000; i++) {
        sum += i;
      }
      return sum;
    });

    const metrics = monitor.getMetrics("sync_test");
    assertEquals(metrics.length, 1);
    assertExists(metrics[0].value);
    assertEquals(typeof result, "number");
  });

  await t.step("Measure Async Function", async () => {
    const result = await monitor.measureAsync("async_test", async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return "done";
    });

    const metrics = monitor.getMetrics("async_test");
    assertEquals(metrics.length, 1);
    assertExists(metrics[0].value);
    assertEquals(result, "done");
  });

  await t.step("Error Handling", () => {
    try {
      monitor.measure("error_test", () => {
        throw new Error("Test error");
      });
    } catch (error) {
      const metrics = monitor.getMetrics("error_test");
      assertEquals(metrics.length, 1);
      assertEquals(metrics[0].metadata?.status, "error");
    }
  });
});

Deno.test("PerformanceMonitor - Resource Usage", async (t) => {
  const monitor = new PerformanceMonitor();

  await t.step("Get Resource Usage", () => {
    const usage = monitor.getResourceUsage();
    assertExists(usage.memory);
    assertExists(usage.timestamp);
    assertEquals(typeof usage.memory, "number");
    assertEquals(usage.memory >= 0 && usage.memory <= 1, true);
  });
});

Deno.test("PerformanceMonitor - Data Management", async (t) => {
  const monitor = new PerformanceMonitor();

  await t.step("Max Metrics Limit", () => {
    // Record more than MAX_METRICS
    for (let i = 0; i < 11000; i++) {
      monitor.recordMetric("test", i);
    }

    const metrics = monitor.getMetrics("test");
    assertEquals(metrics.length <= 10000, true);
    // Verify we kept the most recent metrics
    assertEquals(metrics[metrics.length - 1].value, 10999);
  });

  await t.step("Max Alerts Limit", () => {
    monitor.setThreshold("test", { warning: 0, error: 50 });

    // Generate more than MAX_ALERTS
    for (let i = 0; i < 1100; i++) {
      monitor.recordMetric("test", 100);
    }

    const alerts = monitor.getAlerts();
    assertEquals(alerts.length <= 1000, true);
  });

  await t.step("Clear Data", () => {
    monitor.clearMetrics();
    monitor.clearAlerts();

    assertEquals(monitor.getMetrics().length, 0);
    assertEquals(monitor.getAlerts().length, 0);
  });
});