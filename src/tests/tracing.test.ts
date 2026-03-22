/**
 * Tests for tracing/recording system
 * Validates cassette format, masking, and recording/replay
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Cassette
  createCassette,
  createEntry,
  addEntry,
  serializeCassette,
  parseCassette,
  findMatchingEntry,
  diffCassettes,
  hasBreakingChanges,
  type Cassette,
  type CassetteEntry,
  type CassetteRequest,
  type CassetteResponse,
  // Masking
  maskString,
  maskObject,
  maskHeaders,
  maskUrl,
  maskJsonBody,
  maskEntry,
  defaultMaskingConfig,
  createMaskingConfig,
  // Player
  MemoryCassetteStorage,
  CassettePlayer,
  isCassetteStale,
  mergeCassettes,
} from '../testing/index.js';

// =============================================================================
// CASSETTE FORMAT TESTS
// =============================================================================

describe('Cassette format', () => {
  describe('createCassette', () => {
    it('creates empty cassette with metadata', () => {
      const cassette = createCassette('test-cassette', ['acuity']);

      expect(cassette.version).toBe('1.0');
      expect(cassette.name).toBe('test-cassette');
      expect(cassette.entries).toEqual([]);
      expect(cassette.config.services).toContain('acuity');
      expect(cassette.environment.nodeVersion).toBeDefined();
      expect(cassette.environment.platform).toBeDefined();
    });
  });

  describe('createEntry', () => {
    it('creates entry with request and response', () => {
      const request: CassetteRequest = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { authorization: 'Bearer token' },
      };

      const response: CassetteResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"users":[]}',
        json: { users: [] },
      };

      const entry = createEntry(request, response, 150);

      expect(entry.id).toMatch(/^entry-/);
      expect(entry.recordedAt).toBeDefined();
      expect(entry.duration).toBe(150);
      expect(entry.request).toEqual(request);
      expect(entry.response).toEqual(response);
    });
  });

  describe('addEntry', () => {
    it('adds entry immutably', () => {
      const cassette = createCassette('test', []);
      const entry = createEntry(
        { method: 'GET', url: 'https://test.com', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      );

      const updated = addEntry(cassette, entry);

      expect(cassette.entries.length).toBe(0);
      expect(updated.entries.length).toBe(1);
      expect(updated.entries[0]).toEqual(entry);
    });
  });

  describe('serialization', () => {
    it('serializes and parses cassette', () => {
      const cassette = createCassette('serialize-test', ['acuity', 'paypal']);
      const entry = createEntry(
        { method: 'POST', url: 'https://api.com/create', headers: {}, body: '{}' },
        { status: 201, statusText: 'Created', headers: {}, body: '{"id":1}', json: { id: 1 } },
        200
      );
      const withEntry = addEntry(cassette, entry);

      const json = serializeCassette(withEntry);
      const parsed = parseCassette(json);

      expect(parsed.name).toBe('serialize-test');
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0].request.method).toBe('POST');
    });

    it('throws on invalid version', () => {
      const invalid = JSON.stringify({ version: '2.0', name: 'test', entries: [] });
      expect(() => parseCassette(invalid)).toThrow(/Unsupported cassette version/);
    });

    it('throws on missing fields', () => {
      const invalid = JSON.stringify({ version: '1.0' });
      expect(() => parseCassette(invalid)).toThrow(/missing required fields/);
    });
  });
});

// =============================================================================
// CASSETTE MATCHING TESTS
// =============================================================================

describe('Cassette matching', () => {
  let cassette: Cassette;

  beforeEach(() => {
    cassette = createCassette('match-test', []);

    // Add some entries
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/users', headers: {} },
        { status: 200, statusText: 'OK', headers: {}, body: '[]' },
        100
      )
    );
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'POST', url: 'https://api.com/users', headers: {}, body: '{}' },
        { status: 201, statusText: 'Created', headers: {}, body: '{"id":1}' },
        150
      )
    );
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/users/1', headers: {} },
        { status: 200, statusText: 'OK', headers: {}, body: '{"id":1}' },
        80
      )
    );
  });

  describe('findMatchingEntry', () => {
    it('finds entry by method and path', () => {
      const request: CassetteRequest = {
        method: 'GET',
        url: 'https://api.com/users',
        headers: {},
      };

      const entry = findMatchingEntry(cassette, request);

      expect(entry).toBeDefined();
      expect(entry?.request.method).toBe('GET');
    });

    it('distinguishes by method', () => {
      const request: CassetteRequest = {
        method: 'POST',
        url: 'https://api.com/users',
        headers: {},
      };

      const entry = findMatchingEntry(cassette, request);

      expect(entry?.request.method).toBe('POST');
      expect(entry?.response.status).toBe(201);
    });

    it('returns undefined for non-matching request', () => {
      const request: CassetteRequest = {
        method: 'DELETE',
        url: 'https://api.com/users/1',
        headers: {},
      };

      const entry = findMatchingEntry(cassette, request);

      expect(entry).toBeUndefined();
    });

    it('matches with exactUrl option', () => {
      const request: CassetteRequest = {
        method: 'GET',
        url: 'https://api.com/users?limit=10',
        headers: {},
      };

      // Without exactUrl - matches path only
      const entry1 = findMatchingEntry(cassette, request, { exactUrl: false });
      expect(entry1).toBeDefined();

      // With exactUrl - no match (query params differ)
      const entry2 = findMatchingEntry(cassette, request, { exactUrl: true });
      expect(entry2).toBeUndefined();
    });
  });
});

// =============================================================================
// CASSETTE DIFFING TESTS
// =============================================================================

describe('Cassette diffing', () => {
  it('detects added entries', () => {
    const old = createCassette('old', []);
    const new_ = addEntry(
      createCassette('new', []),
      createEntry(
        { method: 'GET', url: 'https://api.com/new', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );

    const diff = diffCassettes(old, new_);

    expect(diff.added.length).toBe(1);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
  });

  it('detects removed entries', () => {
    const old = addEntry(
      createCassette('old', []),
      createEntry(
        { method: 'GET', url: 'https://api.com/removed', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    const new_ = createCassette('new', []);

    const diff = diffCassettes(old, new_);

    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(1);
    expect(diff.changed.length).toBe(0);
  });

  it('detects status code changes', () => {
    const old = addEntry(
      createCassette('old', []),
      createEntry(
        { method: 'GET', url: 'https://api.com/status', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    const new_ = addEntry(
      createCassette('new', []),
      createEntry(
        { method: 'GET', url: 'https://api.com/status', headers: {} },
        { status: 404, statusText: 'Not Found', headers: {} },
        100
      )
    );

    const diff = diffCassettes(old, new_);

    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].path).toContain('status');
    expect(diff.changed[0].oldValue).toBe(200);
    expect(diff.changed[0].newValue).toBe(404);
  });

  describe('hasBreakingChanges', () => {
    it('returns true for removed endpoints', () => {
      const old = addEntry(
        createCassette('old', []),
        createEntry(
          { method: 'GET', url: 'https://api.com/removed', headers: {} },
          { status: 200, statusText: 'OK', headers: {} },
          100
        )
      );
      const new_ = createCassette('new', []);

      const diff = diffCassettes(old, new_);
      expect(hasBreakingChanges(diff)).toBe(true);
    });

    it('returns true for status code changes', () => {
      const old = addEntry(
        createCassette('old', []),
        createEntry(
          { method: 'GET', url: 'https://api.com/status', headers: {} },
          { status: 200, statusText: 'OK', headers: {} },
          100
        )
      );
      const new_ = addEntry(
        createCassette('new', []),
        createEntry(
          { method: 'GET', url: 'https://api.com/status', headers: {} },
          { status: 500, statusText: 'Error', headers: {} },
          100
        )
      );

      const diff = diffCassettes(old, new_);
      expect(hasBreakingChanges(diff)).toBe(true);
    });

    it('returns false for no changes', () => {
      const cassette = addEntry(
        createCassette('test', []),
        createEntry(
          { method: 'GET', url: 'https://api.com/same', headers: {} },
          { status: 200, statusText: 'OK', headers: {} },
          100
        )
      );

      const diff = diffCassettes(cassette, cassette);
      expect(hasBreakingChanges(diff)).toBe(false);
    });
  });
});

// =============================================================================
// MASKING TESTS
// =============================================================================

describe('Masking', () => {
  describe('maskString', () => {
    it('masks email addresses', () => {
      const result = maskString('Contact: john@example.com for info');
      expect(result).not.toContain('john@example.com');
      expect(result).toContain('[MASKED_EMAIL]');
    });

    it('masks phone numbers', () => {
      const result = maskString('Call (607) 555-1234 today');
      expect(result).not.toContain('555-1234');
      expect(result).toContain('[MASKED_PHONE]');
    });

    it('masks Bearer tokens', () => {
      const result = maskString('Bearer abc123def456');
      expect(result).not.toContain('abc123def456');
      expect(result).toContain('Bearer [MASKED_TOKEN]');
    });

    it('masks Basic auth', () => {
      const result = maskString('Basic dXNlcjpwYXNz');
      expect(result).toContain('Basic [MASKED_CREDENTIALS]');
    });

    it('masks API keys', () => {
      // Pattern matches prefixes (sk_, pk_, api_, key_) + 20+ alphanumeric
      // Using only letters to avoid phone number pattern overlap
      const result = maskString('Use key: sk_abcdefghijklmnopqrstuvwxy');
      expect(result).toContain('[MASKED_API_KEY]');
    });
  });

  describe('maskObject', () => {
    it('masks sensitive fields by name', () => {
      const obj = {
        email: 'test@example.com',
        password: 'secret123',
        name: 'John Doe',
      };

      const result = maskObject(obj);

      expect(result.email).toContain('[MASKED');
      expect(result.password).toContain('[MASKED');
      expect(result.name).toBe('John Doe');
    });

    it('masks nested objects', () => {
      const obj = {
        user: {
          email: 'nested@example.com',
          profile: {
            phone: '(555) 123-4567',
          },
        },
      };

      const result = maskObject(obj);

      expect(result.user.email).toContain('[MASKED');
      expect(result.user.profile.phone).toContain('[MASKED_PHONE]');
    });

    it('masks arrays of non-sensitive items by pattern', () => {
      const obj = {
        messages: ['Contact me at one@test.com', 'Or at two@test.com'],
      };

      const result = maskObject(obj);

      expect(result.messages[0]).toContain('[MASKED_EMAIL]');
      expect(result.messages[1]).toContain('[MASKED_EMAIL]');
    });

    it('masks entire array if field name is sensitive', () => {
      const obj = {
        emails: ['one@test.com', 'two@test.com'],
      };

      const result = maskObject(obj);

      // 'emails' contains 'email' which is a sensitive field
      expect(result.emails).toBe('[MASKED]');
    });

    it('preserves structure with preserveStructure option', () => {
      const obj = {
        password: 'secret',
        count: 42,
        active: true,
      };

      const result = maskObject(obj, defaultMaskingConfig);

      // password is a sensitive field, gets masked
      expect(typeof result.password).toBe('string');
      expect(result.password).toContain('[MASKED');
      // count and active are not sensitive fields, preserved
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
    });
  });

  describe('maskHeaders', () => {
    it('masks authorization header', () => {
      const headers = {
        authorization: 'Bearer token123',
        'content-type': 'application/json',
      };

      const result = maskHeaders(headers);

      expect(result.authorization).toContain('[MASKED');
      expect(result['content-type']).toBe('application/json');
    });

    it('masks custom sensitive headers', () => {
      const config = createMaskingConfig({
        sensitiveHeaders: ['x-custom-secret'],
      });

      const headers = {
        'x-custom-secret': 'my-secret-value',
      };

      const result = maskHeaders(headers, config);

      expect(result['x-custom-secret']).toContain('[MASKED');
    });
  });

  describe('maskUrl', () => {
    it('masks sensitive query params', () => {
      const url = 'https://api.com/auth?apiKey=secret123&format=json';
      const result = maskUrl(url);

      expect(result).not.toContain('secret123');
      // URL-encoded brackets: %5B = [, %5D = ]
      expect(result).toMatch(/MASKED/);
      expect(result).toContain('format=json');
    });
  });

  describe('maskJsonBody', () => {
    it('masks JSON body', () => {
      const body = JSON.stringify({
        email: 'user@test.com',
        data: 'public',
      });

      const result = maskJsonBody(body);
      const parsed = JSON.parse(result);

      expect(parsed.email).toContain('[MASKED');
      expect(parsed.data).toBe('public');
    });

    it('handles non-JSON gracefully', () => {
      const body = 'plain text with email@test.com';
      const result = maskJsonBody(body);

      expect(result).toContain('[MASKED_EMAIL]');
    });
  });

  describe('maskEntry', () => {
    it('masks full cassette entry', () => {
      const entry: CassetteEntry = {
        id: 'test-1',
        recordedAt: '2026-01-01T00:00:00Z',
        duration: 100,
        request: {
          method: 'POST',
          url: 'https://api.com/users?apiKey=secret',
          headers: { authorization: 'Bearer token' },
          body: JSON.stringify({ email: 'test@example.com' }),
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: JSON.stringify({ id: 1, email: 'test@example.com' }),
          json: { id: 1, email: 'test@example.com' },
        },
      };

      const masked = maskEntry(entry);

      expect(masked.request.headers.authorization).toContain('[MASKED');
      expect(masked.request.url).not.toContain('secret');
      expect(masked.response.json).toBeDefined();
      expect((masked.response.json as Record<string, unknown>).email).toContain('[MASKED');
    });
  });
});

// =============================================================================
// PLAYER TESTS
// =============================================================================

describe('CassettePlayer', () => {
  let storage: MemoryCassetteStorage;
  let player: CassettePlayer;

  beforeEach(() => {
    storage = new MemoryCassetteStorage();
    player = new CassettePlayer({ storage });
  });

  it('loads cassette from storage', async () => {
    const cassette = createCassette('test-load', ['acuity']);
    await storage.save(cassette);

    const loaded = await player.load('test-load');

    expect(loaded.name).toBe('test-load');
  });

  it('finds response for matching request', async () => {
    let cassette = createCassette('test-find', []);
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/data', headers: {} },
        { status: 200, statusText: 'OK', headers: {}, body: '{"found":true}' },
        100
      )
    );
    await storage.save(cassette);
    await player.load('test-find');

    const entry = player.findResponse({
      method: 'GET',
      url: 'https://api.com/data',
    });

    expect(entry).toBeDefined();
    expect(entry?.response.body).toContain('found');
  });

  it('tracks usage statistics', async () => {
    let cassette = createCassette('test-stats', []);
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/one', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/two', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    await storage.save(cassette);
    await player.load('test-stats');

    // Use one entry
    player.findResponse({ method: 'GET', url: 'https://api.com/one' });

    const stats = player.getStats();

    expect(stats.totalEntries).toBe(2);
    expect(stats.usedEntries).toBe(1);
    expect(stats.unusedEntries).toBe(1);
    expect(stats.coverage).toBe(0.5);
  });

  it('returns unused entries', async () => {
    let cassette = createCassette('test-unused', []);
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/used', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    cassette = addEntry(
      cassette,
      createEntry(
        { method: 'GET', url: 'https://api.com/unused', headers: {} },
        { status: 200, statusText: 'OK', headers: {} },
        100
      )
    );
    await storage.save(cassette);
    await player.load('test-unused');

    player.findResponse({ method: 'GET', url: 'https://api.com/used' });
    const unused = player.getUnusedEntries();

    expect(unused.length).toBe(1);
    expect(unused[0].request.url).toContain('unused');
  });
});

// =============================================================================
// UTILITY TESTS
// =============================================================================

describe('Cassette utilities', () => {
  describe('isCassetteStale', () => {
    it('returns false for fresh cassette', () => {
      const cassette = createCassette('fresh', []);
      expect(isCassetteStale(cassette, 30)).toBe(false);
    });

    it('returns true for old cassette', () => {
      const cassette = createCassette('old', []);
      cassette.updatedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

      expect(isCassetteStale(cassette, 30)).toBe(true);
    });
  });

  describe('mergeCassettes', () => {
    it('merges multiple cassettes', () => {
      const c1 = addEntry(
        createCassette('c1', ['acuity']),
        createEntry(
          { method: 'GET', url: 'https://api.com/one', headers: {} },
          { status: 200, statusText: 'OK', headers: {} },
          100
        )
      );
      const c2 = addEntry(
        createCassette('c2', ['paypal']),
        createEntry(
          { method: 'GET', url: 'https://api.com/two', headers: {} },
          { status: 200, statusText: 'OK', headers: {} },
          100
        )
      );

      const merged = mergeCassettes([c1, c2], 'merged');

      expect(merged.name).toBe('merged');
      expect(merged.entries.length).toBe(2);
      expect(merged.config.services).toContain('acuity');
      expect(merged.config.services).toContain('paypal');
    });
  });
});

describe('MemoryCassetteStorage', () => {
  let storage: MemoryCassetteStorage;

  beforeEach(() => {
    storage = new MemoryCassetteStorage();
  });

  it('saves and loads cassettes', async () => {
    const cassette = createCassette('memory-test', []);
    await storage.save(cassette);

    const loaded = await storage.load('memory-test');
    expect(loaded.name).toBe('memory-test');
  });

  it('lists cassettes', async () => {
    await storage.save(createCassette('one', []));
    await storage.save(createCassette('two', []));

    const list = await storage.list();
    expect(list).toContain('one');
    expect(list).toContain('two');
  });

  it('deletes cassettes', async () => {
    await storage.save(createCassette('delete-me', []));
    expect(await storage.exists('delete-me')).toBe(true);

    await storage.delete('delete-me');
    expect(await storage.exists('delete-me')).toBe(false);
  });

  it('throws on load non-existent', async () => {
    await expect(storage.load('not-exists')).rejects.toThrow(/not found/);
  });
});
