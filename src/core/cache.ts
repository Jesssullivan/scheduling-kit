/**
 * Simple In-Memory Cache with TTL
 * Used for caching scraped Acuity data
 */

// =============================================================================
// TYPES
// =============================================================================

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheConfig {
  /** Default TTL in milliseconds */
  defaultTTL: number;
  /** Maximum entries before pruning */
  maxEntries?: number;
  /** Callback when cache is updated */
  onUpdate?: (key: string, value: unknown) => void;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

// =============================================================================
// CACHE IMPLEMENTATION
// =============================================================================

export class SimpleCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private config: Required<CacheConfig>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    entries: 0,
    oldestEntry: null,
    newestEntry: null,
  };

  constructor(config: CacheConfig) {
    this.config = {
      maxEntries: 1000,
      onUpdate: () => {},
      ...config,
    };
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.updateStats();
      return undefined;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl ?? this.config.defaultTTL);

    // Prune if at capacity
    if (this.cache.size >= this.config.maxEntries!) {
      this.prune();
    }

    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: now,
    });

    this.updateStats();
    this.config.onUpdate(key, value);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.updateStats();
      return false;
    }

    return true;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.updateStats();
    return result;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      entries: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get remaining TTL for a key in milliseconds
   */
  ttl(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : null;
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }

    // If still at capacity, remove oldest entries
    if (this.cache.size >= this.config.maxEntries!) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      );

      const toRemove = entries.slice(0, Math.floor(this.config.maxEntries! * 0.1));
      for (const [key] of toRemove) {
        this.cache.delete(key);
        pruned++;
      }
    }

    this.updateStats();
    return pruned;
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.stats.entries = this.cache.size;

    if (this.cache.size === 0) {
      this.stats.oldestEntry = null;
      this.stats.newestEntry = null;
      return;
    }

    let oldest = Infinity;
    let newest = 0;

    for (const entry of this.cache.values()) {
      if (entry.createdAt < oldest) oldest = entry.createdAt;
      if (entry.createdAt > newest) newest = entry.createdAt;
    }

    this.stats.oldestEntry = oldest;
    this.stats.newestEntry = newest;
  }
}

// =============================================================================
// SCHEDULING-SPECIFIC CACHE
// =============================================================================

export interface SchedulingCacheData {
  services: {
    value: unknown[];
    lastUpdated: number;
  };
  availability: Map<string, { dates: string[]; lastUpdated: number }>;
  timeSlots: Map<string, { slots: unknown[]; lastUpdated: number }>;
}

/**
 * Create a cache instance pre-configured for scheduling data
 * Default TTL: 15 minutes
 */
export const createSchedulingCache = (ttlMs: number = 15 * 60 * 1000) => {
  const servicesCache = new SimpleCache<unknown[]>({ defaultTTL: ttlMs });
  const availabilityCache = new SimpleCache<string[]>({ defaultTTL: ttlMs });
  const timeSlotsCache = new SimpleCache<unknown[]>({ defaultTTL: ttlMs });

  return {
    services: servicesCache,
    availability: availabilityCache,
    timeSlots: timeSlotsCache,

    /**
     * Clear all caches
     */
    clearAll: () => {
      servicesCache.clear();
      availabilityCache.clear();
      timeSlotsCache.clear();
    },

    /**
     * Get combined stats
     */
    getStats: () => ({
      services: servicesCache.getStats(),
      availability: availabilityCache.getStats(),
      timeSlots: timeSlotsCache.getStats(),
    }),

    /**
     * Prune all caches
     */
    pruneAll: () => ({
      services: servicesCache.prune(),
      availability: availabilityCache.prune(),
      timeSlots: timeSlotsCache.prune(),
    }),
  };
};

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let globalCache: ReturnType<typeof createSchedulingCache> | null = null;

/**
 * Get the global scheduling cache instance
 */
export const getSchedulingCache = (ttlMs?: number) => {
  if (!globalCache) {
    globalCache = createSchedulingCache(ttlMs);
  }
  return globalCache;
};

/**
 * Reset the global cache (useful for testing)
 */
export const resetSchedulingCache = () => {
  if (globalCache) {
    globalCache.clearAll();
  }
  globalCache = null;
};
