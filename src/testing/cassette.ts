/**
 * Cassette Format
 * Extended HAR (HTTP Archive) format for API recordings
 */

// =============================================================================
// CASSETTE TYPES
// =============================================================================

/**
 * HTTP request in cassette format
 */
export interface CassetteRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  queryParams?: Record<string, string>;
}

/**
 * HTTP response in cassette format
 */
export interface CassetteResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  /** JSON-parsed body for convenience */
  json?: unknown;
}

/**
 * Single HTTP interaction (request + response pair)
 */
export interface CassetteEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp when recorded */
  recordedAt: string;
  /** Request duration in ms */
  duration: number;
  /** HTTP request */
  request: CassetteRequest;
  /** HTTP response */
  response: CassetteResponse;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Full cassette containing multiple interactions
 */
export interface Cassette {
  /** Cassette format version */
  version: '1.0';
  /** Human-readable name */
  name: string;
  /** When cassette was created */
  createdAt: string;
  /** When cassette was last updated */
  updatedAt: string;
  /** Recording environment info */
  environment: {
    /** Node.js version */
    nodeVersion: string;
    /** Platform (darwin, linux, win32) */
    platform: string;
    /** Timezone used during recording */
    timezone: string;
    /** Custom environment tags */
    tags?: string[];
  };
  /** Configuration used during recording */
  config: {
    /** Services recorded (e.g., 'acuity', 'paypal') */
    services: string[];
    /** Fields that were masked */
    maskedFields: string[];
    /** Recording mode */
    mode: 'record' | 'replay' | 'passthrough';
  };
  /** HTTP interaction entries */
  entries: CassetteEntry[];
}

// =============================================================================
// CASSETTE BUILDERS
// =============================================================================

/**
 * Create an empty cassette
 */
export const createCassette = (name: string, services: string[] = []): Cassette => ({
  version: '1.0',
  name,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  config: {
    services,
    maskedFields: [],
    mode: 'record',
  },
  entries: [],
});

/**
 * Create a cassette entry from request/response
 */
export const createEntry = (
  request: CassetteRequest,
  response: CassetteResponse,
  duration: number
): CassetteEntry => ({
  id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  recordedAt: new Date().toISOString(),
  duration,
  request,
  response,
});

/**
 * Add entry to cassette (immutable)
 */
export const addEntry = (cassette: Cassette, entry: CassetteEntry): Cassette => ({
  ...cassette,
  updatedAt: new Date().toISOString(),
  entries: [...cassette.entries, entry],
});

// =============================================================================
// CASSETTE SERIALIZATION
// =============================================================================

/**
 * Serialize cassette to JSON string
 */
export const serializeCassette = (cassette: Cassette): string =>
  JSON.stringify(cassette, null, 2);

/**
 * Parse cassette from JSON string
 */
export const parseCassette = (json: string): Cassette => {
  const parsed = JSON.parse(json);

  // Validate version
  if (parsed.version !== '1.0') {
    throw new Error(`Unsupported cassette version: ${parsed.version}`);
  }

  // Validate required fields
  if (!parsed.name || !parsed.entries || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid cassette format: missing required fields');
  }

  return parsed as Cassette;
};

// =============================================================================
// CASSETTE MATCHING
// =============================================================================

/**
 * Request matching options
 */
export interface MatchOptions {
  /** Match URL exactly (vs. ignoring query params) */
  exactUrl?: boolean;
  /** Match headers */
  matchHeaders?: string[];
  /** Match body (for POST/PUT) */
  matchBody?: boolean;
  /** Custom matcher function */
  customMatcher?: (recorded: CassetteRequest, incoming: CassetteRequest) => boolean;
}

/**
 * Find matching entry in cassette for an incoming request
 */
export const findMatchingEntry = (
  cassette: Cassette,
  request: CassetteRequest,
  options: MatchOptions = {}
): CassetteEntry | undefined => {
  const { exactUrl = false, matchHeaders = [], matchBody = false } = options;

  return cassette.entries.find((entry) => {
    // Method must match
    if (entry.request.method !== request.method) {
      return false;
    }

    // URL matching
    if (exactUrl) {
      if (entry.request.url !== request.url) {
        return false;
      }
    } else {
      // Match URL path (ignore query params)
      const recordedPath = new URL(entry.request.url).pathname;
      const incomingPath = new URL(request.url).pathname;
      if (recordedPath !== incomingPath) {
        return false;
      }
    }

    // Header matching
    for (const header of matchHeaders) {
      const headerLower = header.toLowerCase();
      if (entry.request.headers[headerLower] !== request.headers[headerLower]) {
        return false;
      }
    }

    // Body matching
    if (matchBody && entry.request.body !== request.body) {
      return false;
    }

    // Custom matcher
    if (options.customMatcher && !options.customMatcher(entry.request, request)) {
      return false;
    }

    return true;
  });
};

// =============================================================================
// CASSETTE DIFFING
// =============================================================================

/**
 * Diff result for API changes
 */
export interface CassetteDiff {
  /** Entries that exist in both but differ */
  changed: Array<{
    entryId: string;
    path: string[];
    oldValue: unknown;
    newValue: unknown;
  }>;
  /** Entries only in the old cassette */
  removed: CassetteEntry[];
  /** Entries only in the new cassette */
  added: CassetteEntry[];
}

/**
 * Compare two cassettes to detect API changes
 */
export const diffCassettes = (oldCassette: Cassette, newCassette: Cassette): CassetteDiff => {
  const diff: CassetteDiff = {
    changed: [],
    removed: [],
    added: [],
  };

  // Build maps for O(1) lookup
  const oldByUrl = new Map(oldCassette.entries.map((e) => [entryKey(e), e]));
  const newByUrl = new Map(newCassette.entries.map((e) => [entryKey(e), e]));

  // Find removed and changed
  for (const [key, oldEntry] of oldByUrl) {
    const newEntry = newByUrl.get(key);
    if (!newEntry) {
      diff.removed.push(oldEntry);
    } else {
      // Compare responses
      const changes = compareResponses(oldEntry, newEntry);
      diff.changed.push(...changes);
    }
  }

  // Find added
  for (const [key, newEntry] of newByUrl) {
    if (!oldByUrl.has(key)) {
      diff.added.push(newEntry);
    }
  }

  return diff;
};

/**
 * Generate a unique key for an entry (method + path)
 */
const entryKey = (entry: CassetteEntry): string => {
  const url = new URL(entry.request.url);
  return `${entry.request.method}:${url.pathname}`;
};

/**
 * Compare responses between two entries
 */
const compareResponses = (
  oldEntry: CassetteEntry,
  newEntry: CassetteEntry
): CassetteDiff['changed'] => {
  const changes: CassetteDiff['changed'] = [];

  // Status code change
  if (oldEntry.response.status !== newEntry.response.status) {
    changes.push({
      entryId: oldEntry.id,
      path: ['response', 'status'],
      oldValue: oldEntry.response.status,
      newValue: newEntry.response.status,
    });
  }

  // Compare JSON bodies if present
  if (oldEntry.response.json && newEntry.response.json) {
    const bodyChanges = compareObjects(
      oldEntry.response.json as Record<string, unknown>,
      newEntry.response.json as Record<string, unknown>,
      ['response', 'json']
    );
    changes.push(
      ...bodyChanges.map((c) => ({
        entryId: oldEntry.id,
        ...c,
      }))
    );
  }

  return changes;
};

/**
 * Recursively compare two objects and return differences
 */
const compareObjects = (
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  path: string[] = []
): Array<{ path: string[]; oldValue: unknown; newValue: unknown }> => {
  const changes: Array<{ path: string[]; oldValue: unknown; newValue: unknown }> = [];

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const currentPath = [...path, key];
    const oldValue = oldObj[key];
    const newValue = newObj[key];

    if (oldValue === newValue) {
      continue;
    }

    if (
      typeof oldValue === 'object' &&
      typeof newValue === 'object' &&
      oldValue !== null &&
      newValue !== null &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue)
    ) {
      changes.push(
        ...compareObjects(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          currentPath
        )
      );
    } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ path: currentPath, oldValue, newValue });
    }
  }

  return changes;
};

/**
 * Check if cassette diff has breaking changes
 */
export const hasBreakingChanges = (diff: CassetteDiff): boolean => {
  // Status code changes are breaking
  const statusChanges = diff.changed.filter(
    (c) => c.path.includes('status') && c.oldValue !== c.newValue
  );

  // Removed fields in response are breaking
  const removedFields = diff.changed.filter((c) => c.newValue === undefined);

  return diff.removed.length > 0 || statusChanges.length > 0 || removedFields.length > 0;
};
