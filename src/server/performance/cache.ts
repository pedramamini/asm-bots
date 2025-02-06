interface CacheOptions {
  maxSize: number;
  ttl: number; // Time to live in milliseconds
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class Cache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private ttl: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: CacheOptions) {
    this.cache = new Map();
    this.maxSize = options.maxSize;
    this.ttl = options.ttl;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl,
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expires <= Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  private evictOldest(): void {
    const now = Date.now();
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires < oldestTime) {
        oldestKey = key;
        oldestTime = entry.expires;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      usage: this.cache.size / this.maxSize,
    };
  }
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  usage: number;
}

export class CacheManager {
  private caches: Map<string, Cache<unknown>> = new Map();

  createCache<T>(name: string, options: CacheOptions): Cache<T> {
    const cache = new Cache<T>(options);
    this.caches.set(name, cache as Cache<unknown>);
    return cache;
  }

  getCache<T>(name: string): Cache<T> | null {
    const cache = this.caches.get(name);
    return cache ? (cache as Cache<T>) : null;
  }

  deleteCache(name: string): void {
    this.caches.delete(name);
  }

  clearAll(): void {
    this.caches.forEach(cache => cache.clear());
  }

  getAllStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    this.caches.forEach((cache, name) => {
      stats[name] = cache.getStats();
    });
    return stats;
  }

  getOverallHitRate(): number {
    let totalHits = 0;
    let totalRequests = 0;

    this.caches.forEach(cache => {
      const stats = cache.getStats();
      totalHits += stats.hits;
      totalRequests += stats.hits + stats.misses;
    });

    return totalRequests > 0 ? totalHits / totalRequests : 0;
  }
}

// Default cache configurations
export const CACHE_CONFIG = {
  LEADERBOARD: {
    maxSize: 1000,
    ttl: 5 * 60 * 1000, // 5 minutes
  },
  USER_PROFILE: {
    maxSize: 10000,
    ttl: 15 * 60 * 1000, // 15 minutes
  },
  BATTLE_HISTORY: {
    maxSize: 5000,
    ttl: 10 * 60 * 1000, // 10 minutes
  },
  BOT_CODE: {
    maxSize: 500,
    ttl: 30 * 60 * 1000, // 30 minutes
  },
  RANKING: {
    maxSize: 2000,
    ttl: 2 * 60 * 1000, // 2 minutes
  },
} as const;