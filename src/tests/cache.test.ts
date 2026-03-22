/**
 * Cache Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SimpleCache,
  createSchedulingCache,
  getSchedulingCache,
  resetSchedulingCache,
} from '../core/cache.js';

describe('SimpleCache', () => {
  let cache: SimpleCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new SimpleCache<string>({ defaultTTL: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('sets and gets a value', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('returns undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('checks if key exists', () => {
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('deletes a key', () => {
      cache.set('key', 'value');
      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('clears all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });

    it('returns all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.keys()).toEqual(['key1', 'key2']);
    });
  });

  describe('TTL expiration', () => {
    it('expires entries after TTL', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(1001);
      expect(cache.get('key')).toBeUndefined();
    });

    it('allows custom TTL per entry', () => {
      cache.set('short', 'value', 500);
      cache.set('long', 'value', 2000);

      vi.advanceTimersByTime(501);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('value');

      vi.advanceTimersByTime(1500);
      expect(cache.get('long')).toBeUndefined();
    });

    it('returns remaining TTL', () => {
      cache.set('key', 'value', 1000);
      vi.advanceTimersByTime(300);

      const ttl = cache.ttl('key');
      expect(ttl).toBe(700);
    });

    it('returns null TTL for missing keys', () => {
      expect(cache.ttl('nonexistent')).toBeNull();
    });

    it('returns null TTL for expired keys', () => {
      cache.set('key', 'value', 100);
      vi.advanceTimersByTime(200);
      expect(cache.ttl('key')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('tracks hits and misses', () => {
      cache.set('key', 'value');
      cache.get('key'); // hit
      cache.get('key'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('counts misses for expired entries', () => {
      cache.set('key', 'value', 100);
      cache.get('key'); // hit

      vi.advanceTimersByTime(200);
      cache.get('key'); // miss (expired)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('tracks entry count', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
    });
  });

  describe('pruning', () => {
    it('removes expired entries on prune', () => {
      cache.set('expired', 'value', 100);
      cache.set('fresh', 'value', 1000);

      vi.advanceTimersByTime(200);
      const pruned = cache.prune();

      expect(pruned).toBe(1);
      expect(cache.get('expired')).toBeUndefined();
      expect(cache.get('fresh')).toBe('value');
    });
  });

  describe('max entries', () => {
    it('prunes expired entries when at capacity', () => {
      const smallCache = new SimpleCache<string>({ defaultTTL: 100, maxEntries: 3 });

      // Add entries with short TTL
      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');

      // Expire them
      vi.advanceTimersByTime(200);

      // Now add a new entry - should prune expired ones first
      smallCache.set('key4', 'value4');

      // key4 should exist
      expect(smallCache.get('key4')).toBe('value4');

      // Expired entries were pruned
      expect(smallCache.getStats().entries).toBe(1);
    });

    it('manual prune removes expired entries', () => {
      const cache = new SimpleCache<string>({ defaultTTL: 100, maxEntries: 10 });

      cache.set('expire1', 'value', 50);
      cache.set('expire2', 'value', 50);
      cache.set('keep', 'value', 1000);

      vi.advanceTimersByTime(60);

      const pruned = cache.prune();

      expect(pruned).toBe(2);
      expect(cache.get('keep')).toBe('value');
      expect(cache.get('expire1')).toBeUndefined();
    });
  });
});

describe('createSchedulingCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSchedulingCache();
  });

  it('creates cache with services, availability, and timeSlots', () => {
    const cache = createSchedulingCache();

    expect(cache.services).toBeDefined();
    expect(cache.availability).toBeDefined();
    expect(cache.timeSlots).toBeDefined();
  });

  it('clears all caches', () => {
    const cache = createSchedulingCache();

    cache.services.set('key', [{ id: '1' }]);
    cache.availability.set('key', ['2026-02-15']);
    cache.timeSlots.set('key', [{ time: '10:00' }]);

    cache.clearAll();

    expect(cache.services.get('key')).toBeUndefined();
    expect(cache.availability.get('key')).toBeUndefined();
    expect(cache.timeSlots.get('key')).toBeUndefined();
  });

  it('returns combined stats', () => {
    const cache = createSchedulingCache();

    cache.services.set('key', []);
    cache.availability.set('key', []);

    const stats = cache.getStats();

    expect(stats.services.entries).toBe(1);
    expect(stats.availability.entries).toBe(1);
    expect(stats.timeSlots.entries).toBe(0);
  });

  it('uses default 15-minute TTL', () => {
    const cache = createSchedulingCache();

    cache.services.set('key', []);

    // Should exist after 14 minutes
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(cache.services.get('key')).toBeDefined();

    // Should expire after 15 minutes
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cache.services.get('key')).toBeUndefined();
  });

  it('accepts custom TTL', () => {
    const cache = createSchedulingCache(5 * 60 * 1000); // 5 minutes

    cache.services.set('key', []);

    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(cache.services.get('key')).toBeUndefined();
  });
});

describe('getSchedulingCache (singleton)', () => {
  afterEach(() => {
    resetSchedulingCache();
  });

  it('returns the same instance', () => {
    const cache1 = getSchedulingCache();
    const cache2 = getSchedulingCache();

    expect(cache1).toBe(cache2);
  });

  it('resets singleton', () => {
    const cache1 = getSchedulingCache();
    cache1.services.set('key', []);

    resetSchedulingCache();

    const cache2 = getSchedulingCache();
    expect(cache2.services.get('key')).toBeUndefined();
  });
});
