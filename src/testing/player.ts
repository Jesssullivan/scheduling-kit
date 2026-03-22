/**
 * Cassette Player
 * Load and replay cassettes for testing
 */

import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Cassette, CassetteEntry, MatchOptions } from './cassette.js';
import { parseCassette, findMatchingEntry, diffCassettes, hasBreakingChanges } from './cassette.js';

// =============================================================================
// CASSETTE STORAGE
// =============================================================================

/**
 * Cassette storage interface
 */
export interface CassetteStorage {
  /** Load cassette by name */
  load(name: string): Promise<Cassette>;
  /** Save cassette */
  save(cassette: Cassette): Promise<void>;
  /** List available cassettes */
  list(): Promise<string[]>;
  /** Delete cassette */
  delete(name: string): Promise<void>;
  /** Check if cassette exists */
  exists(name: string): Promise<boolean>;
}

/**
 * File-based cassette storage
 */
export class FileCassetteStorage implements CassetteStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private getPath(name: string): string {
    // Sanitize name to prevent directory traversal
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(this.basePath, `${safeName}.json`);
  }

  async load(name: string): Promise<Cassette> {
    const path = this.getPath(name);
    const content = await fs.readFile(path, 'utf-8');
    return parseCassette(content);
  }

  async save(cassette: Cassette): Promise<void> {
    const path = this.getPath(cassette.name);

    // Ensure directory exists
    await fs.mkdir(dirname(path), { recursive: true });

    // Write cassette
    await fs.writeFile(path, JSON.stringify(cassette, null, 2), 'utf-8');
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async delete(name: string): Promise<void> {
    const path = this.getPath(name);
    await fs.unlink(path);
  }

  async exists(name: string): Promise<boolean> {
    const path = this.getPath(name);
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * In-memory cassette storage (for testing)
 */
export class MemoryCassetteStorage implements CassetteStorage {
  private cassettes: Map<string, Cassette> = new Map();

  async load(name: string): Promise<Cassette> {
    const cassette = this.cassettes.get(name);
    if (!cassette) {
      throw new Error(`Cassette not found: ${name}`);
    }
    return cassette;
  }

  async save(cassette: Cassette): Promise<void> {
    this.cassettes.set(cassette.name, cassette);
  }

  async list(): Promise<string[]> {
    return Array.from(this.cassettes.keys());
  }

  async delete(name: string): Promise<void> {
    this.cassettes.delete(name);
  }

  async exists(name: string): Promise<boolean> {
    return this.cassettes.has(name);
  }

  /** Clear all cassettes (for test cleanup) */
  clear(): void {
    this.cassettes.clear();
  }
}

// =============================================================================
// CASSETTE PLAYER
// =============================================================================

/**
 * Player configuration
 */
export interface PlayerConfig {
  /** Storage backend */
  storage: CassetteStorage;
  /** Request matching options */
  matchOptions?: MatchOptions;
  /** Fail on unmatched requests */
  strict?: boolean;
  /** Default response for unmatched requests (non-strict mode) */
  defaultResponse?: {
    status: number;
    body: string;
  };
}

/**
 * Cassette player for replaying recorded interactions
 */
export class CassettePlayer {
  private config: PlayerConfig;
  private loadedCassettes: Map<string, Cassette> = new Map();
  private usedEntries: Set<string> = new Set();

  constructor(config: PlayerConfig) {
    this.config = {
      strict: true,
      ...config,
    };
  }

  /**
   * Load a cassette for playback
   */
  async load(name: string): Promise<Cassette> {
    if (!this.loadedCassettes.has(name)) {
      const cassette = await this.config.storage.load(name);
      this.loadedCassettes.set(name, cassette);
    }
    return this.loadedCassettes.get(name)!;
  }

  /**
   * Find response for a request across all loaded cassettes
   */
  findResponse(request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): CassetteEntry | undefined {
    const cassetteRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers || {},
      body: request.body,
    };

    for (const cassette of this.loadedCassettes.values()) {
      const entry = findMatchingEntry(cassette, cassetteRequest, this.config.matchOptions);
      if (entry) {
        this.usedEntries.add(entry.id);
        return entry;
      }
    }

    return undefined;
  }

  /**
   * Get statistics about playback
   */
  getStats(): {
    totalEntries: number;
    usedEntries: number;
    unusedEntries: number;
    coverage: number;
  } {
    const totalEntries = Array.from(this.loadedCassettes.values()).reduce(
      (sum, c) => sum + c.entries.length,
      0
    );

    return {
      totalEntries,
      usedEntries: this.usedEntries.size,
      unusedEntries: totalEntries - this.usedEntries.size,
      coverage: totalEntries > 0 ? this.usedEntries.size / totalEntries : 0,
    };
  }

  /**
   * Get unused entries (for detecting stale cassette data)
   */
  getUnusedEntries(): CassetteEntry[] {
    const unused: CassetteEntry[] = [];

    for (const cassette of this.loadedCassettes.values()) {
      for (const entry of cassette.entries) {
        if (!this.usedEntries.has(entry.id)) {
          unused.push(entry);
        }
      }
    }

    return unused;
  }

  /**
   * Reset usage tracking
   */
  resetStats(): void {
    this.usedEntries.clear();
  }

  /**
   * Unload all cassettes
   */
  clear(): void {
    this.loadedCassettes.clear();
    this.usedEntries.clear();
  }
}

// =============================================================================
// CASSETTE MANAGEMENT
// =============================================================================

/**
 * Compare a cassette against live API responses
 */
export const validateCassette = async (
  cassette: Cassette,
  makeLiveRequest: (entry: CassetteEntry) => Promise<{
    status: number;
    body: string;
  }>
): Promise<{
  valid: boolean;
  mismatches: Array<{
    entry: CassetteEntry;
    expected: { status: number; body: string };
    actual: { status: number; body: string };
  }>;
}> => {
  const mismatches: Array<{
    entry: CassetteEntry;
    expected: { status: number; body: string };
    actual: { status: number; body: string };
  }> = [];

  for (const entry of cassette.entries) {
    try {
      const actual = await makeLiveRequest(entry);

      if (
        actual.status !== entry.response.status ||
        actual.body !== entry.response.body
      ) {
        mismatches.push({
          entry,
          expected: {
            status: entry.response.status,
            body: entry.response.body || '',
          },
          actual,
        });
      }
    } catch (error) {
      mismatches.push({
        entry,
        expected: {
          status: entry.response.status,
          body: entry.response.body || '',
        },
        actual: {
          status: 0,
          body: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  };
};

/**
 * Refresh a cassette with fresh API responses
 */
export const refreshCassette = async (
  cassette: Cassette,
  makeLiveRequest: (entry: CassetteEntry) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>,
  options: {
    preserveTimestamps?: boolean;
    updateAllEntries?: boolean;
  } = {}
): Promise<Cassette> => {
  const newEntries: CassetteEntry[] = [];

  for (const entry of cassette.entries) {
    try {
      const response = await makeLiveRequest(entry);

      let json: unknown;
      try {
        json = JSON.parse(response.body);
      } catch {
        // Not JSON
      }

      newEntries.push({
        ...entry,
        recordedAt: options.preserveTimestamps ? entry.recordedAt : new Date().toISOString(),
        response: {
          status: response.status,
          statusText: response.status === 200 ? 'OK' : 'Error',
          headers: response.headers,
          body: response.body,
          json,
        },
      });
    } catch (error) {
      // Keep original entry on error (unless updateAllEntries)
      if (options.updateAllEntries) {
        newEntries.push({
          ...entry,
          response: {
            status: 0,
            statusText: 'Network Error',
            headers: {},
            body: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        newEntries.push(entry);
      }
    }
  }

  return {
    ...cassette,
    updatedAt: new Date().toISOString(),
    entries: newEntries,
  };
};

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Create default file storage in cassettes directory
 */
export const createDefaultStorage = (projectRoot: string): FileCassetteStorage =>
  new FileCassetteStorage(resolve(projectRoot, 'cassettes'));

/**
 * Check if cassette needs refresh based on age
 */
export const isCassetteStale = (cassette: Cassette, maxAgeDays: number = 30): boolean => {
  const updatedAt = new Date(cassette.updatedAt);
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  return Date.now() - updatedAt.getTime() > maxAge;
};

/**
 * Merge multiple cassettes into one
 */
export const mergeCassettes = (cassettes: Cassette[], name: string): Cassette => {
  const allEntries: CassetteEntry[] = [];
  const allServices = new Set<string>();
  const allMaskedFields = new Set<string>();

  for (const cassette of cassettes) {
    allEntries.push(...cassette.entries);
    cassette.config.services.forEach((s) => allServices.add(s));
    cassette.config.maskedFields.forEach((f) => allMaskedFields.add(f));
  }

  return {
    version: '1.0',
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    environment: cassettes[0]?.environment || {
      nodeVersion: process.version,
      platform: process.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    config: {
      services: Array.from(allServices),
      maskedFields: Array.from(allMaskedFields),
      mode: 'replay',
    },
    entries: allEntries,
  };
};

export { diffCassettes, hasBreakingChanges };
