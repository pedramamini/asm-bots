export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  timestamp: number;
}

export interface PerformanceAlert {
  type: 'warning' | 'error';
  metric: string;
  threshold: number;
  value: number;
  timestamp: number;
  message: string;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private alerts: PerformanceAlert[] = [];
  private thresholds: Map<string, { warning: number; error: number }> = new Map();
  private readonly MAX_METRICS = 10000;
  private readonly MAX_ALERTS = 1000;

  constructor() {
    // Set default thresholds
    this.setThreshold('response_time', { warning: 100, error: 500 }); // ms
    this.setThreshold('memory_usage', { warning: 0.7, error: 0.9 }); // percentage
    this.setThreshold('error_rate', { warning: 0.01, error: 0.05 }); // percentage
    this.setThreshold('cache_miss_rate', { warning: 0.3, error: 0.5 }); // percentage
    this.setThreshold('db_query_time', { warning: 50, error: 200 }); // ms
  }

  recordMetric(
    name: string,
    value: number,
    metadata?: Record<string, unknown>
  ): void {
    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: Date.now(),
      metadata,
    };

    this.metrics.push(metric);
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }

    this.checkThresholds(metric);
  }

  private checkThresholds(metric: PerformanceMetric): void {
    const threshold = this.thresholds.get(metric.name);
    if (!threshold) return;

    if (metric.value >= threshold.error) {
      this.addAlert({
        type: 'error',
        metric: metric.name,
        threshold: threshold.error,
        value: metric.value,
        timestamp: metric.timestamp,
        message: `${metric.name} exceeded error threshold: ${metric.value} >= ${threshold.error}`,
      });
    } else if (metric.value >= threshold.warning) {
      this.addAlert({
        type: 'warning',
        metric: metric.name,
        threshold: threshold.warning,
        value: metric.value,
        timestamp: metric.timestamp,
        message: `${metric.name} exceeded warning threshold: ${metric.value} >= ${threshold.warning}`,
      });
    }
  }

  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts.shift();
    }
  }

  setThreshold(
    metricName: string,
    thresholds: { warning: number; error: number }
  ): void {
    this.thresholds.set(metricName, thresholds);
  }

  getMetrics(
    name?: string,
    startTime?: number,
    endTime?: number
  ): PerformanceMetric[] {
    let filtered = this.metrics;

    if (name) {
      filtered = filtered.filter(m => m.name === name);
    }

    if (startTime) {
      filtered = filtered.filter(m => m.timestamp >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter(m => m.timestamp <= endTime);
    }

    return filtered;
  }

  getAlerts(
    type?: 'warning' | 'error',
    startTime?: number,
    endTime?: number
  ): PerformanceAlert[] {
    let filtered = this.alerts;

    if (type) {
      filtered = filtered.filter(a => a.type === type);
    }

    if (startTime) {
      filtered = filtered.filter(a => a.timestamp >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter(a => a.timestamp <= endTime);
    }

    return filtered;
  }

  getMetricStats(name: string, period: number): {
    min: number;
    max: number;
    avg: number;
    count: number;
    p95: number;
    p99: number;
  } {
    const startTime = Date.now() - period;
    const metrics = this.getMetrics(name, startTime);

    if (metrics.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        count: 0,
        p95: 0,
        p99: 0,
      };
    }

    const values = metrics.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      count: values.length,
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    };
  }

  getResourceUsage(): ResourceUsage {
    // Get memory usage with fallback for environments where performance.memory is not available
    let memoryUsage = 0;
    let totalMemory = 1;

    try {
      if (typeof performance !== 'undefined' && performance.memory) {
        memoryUsage = performance.memory.usedJSHeapSize;
        totalMemory = performance.memory.jsHeapSizeLimit;
      } else if (typeof process !== 'undefined' && process.memoryUsage) {
        // Node.js fallback
        const mem = process.memoryUsage();
        memoryUsage = mem.heapUsed;
        totalMemory = mem.heapTotal;
      }
    } catch {
      // If all methods fail, return a safe default
      memoryUsage = 0;
      totalMemory = 1;
    }

    return {
      cpu: 0, // Not consistently available across environments
      memory: memoryUsage / totalMemory,
      timestamp: Date.now(),
    };
  }

  clearMetrics(): void {
    this.metrics = [];
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  // Performance measurement utilities
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.recordMetric(name, duration, metadata);
      return result;
    } catch (error: unknown) {
      const duration = performance.now() - start;
      this.recordMetric(name, duration, {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
        status: 'error',
      });
      throw error;
    }
  }

  measure<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      this.recordMetric(name, duration, metadata);
      return result;
    } catch (error: unknown) {
      const duration = performance.now() - start;
      this.recordMetric(name, duration, {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
        status: 'error',
      });
      throw error;
    }
  }
}

// Create a global instance
export const monitor = new PerformanceMonitor();