#!/usr/bin/env npx tsx
/**
 * Refresh Traces Script
 * Re-records API cassettes from live endpoints
 *
 * IMPORTANT: This script requires valid API credentials in .env.test.local
 *
 * Usage:
 *   pnpm traces:refresh              # Re-record all cassettes
 *   pnpm traces:refresh --service acuity  # Only Acuity
 *   pnpm traces:refresh --dry-run    # Preview without recording
 *   pnpm traces:refresh --compare    # Record and compare to existing
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASSETTES_DIR = resolve(__dirname, '../cassettes');

// Load environment variables
config({ path: resolve(__dirname, '../.env.test.local') });

// =============================================================================
// TYPES
// =============================================================================

interface CassetteEntry {
  id: string;
  recordedAt: string;
  duration: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    json?: unknown;
  };
}

interface Cassette {
  version: '1.0';
  name: string;
  createdAt: string;
  updatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    timezone: string;
  };
  config: {
    services: string[];
    maskedFields: string[];
    mode: string;
  };
  entries: CassetteEntry[];
}

interface TraceConfig {
  name: string;
  service: string;
  endpoints: Array<{
    name: string;
    method: string;
    path: string;
    params?: Record<string, string>;
  }>;
}

// =============================================================================
// ACUITY TRACE CONFIGURATION
// =============================================================================

const ACUITY_TRACES: TraceConfig = {
  name: 'acuity-full',
  service: 'acuity',
  endpoints: [
    { name: 'appointment-types', method: 'GET', path: '/appointment-types' },
    { name: 'calendars', method: 'GET', path: '/calendars' },
    {
      name: 'availability-dates',
      method: 'GET',
      path: '/availability/dates',
      params: { appointmentTypeID: '12345', month: '2026-02' },
    },
    {
      name: 'availability-times',
      method: 'GET',
      path: '/availability/times',
      params: { appointmentTypeID: '12345', date: '2026-02-16' },
    },
  ],
};

// =============================================================================
// RECORDING FUNCTIONS
// =============================================================================

/**
 * Mask sensitive data in cassette
 */
const maskSensitiveData = (cassette: Cassette): Cassette => {
  const masked = JSON.parse(JSON.stringify(cassette)) as Cassette;

  for (const entry of masked.entries) {
    // Mask authorization headers
    if (entry.request.headers['authorization']) {
      entry.request.headers['authorization'] = 'Basic [MASKED]';
    }

    // Mask email addresses in response
    if (entry.response.json) {
      const jsonStr = JSON.stringify(entry.response.json);
      const maskedJson = jsonStr
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'masked@example.com')
        .replace(/\d{3}-\d{3}-\d{4}/g, '555-555-5555')
        .replace(/\(\d{3}\)\s?\d{3}-\d{4}/g, '(555) 555-5555');
      entry.response.json = JSON.parse(maskedJson);
      entry.response.body = maskedJson;
    }
  }

  // Track masked fields
  masked.config.maskedFields = ['authorization', 'email', 'phone'];

  return masked;
};

/**
 * Record API endpoint
 */
const recordEndpoint = async (
  baseUrl: string,
  auth: string,
  endpoint: TraceConfig['endpoints'][0]
): Promise<CassetteEntry> => {
  const url = new URL(endpoint.path, baseUrl);
  if (endpoint.params) {
    for (const [key, value] of Object.entries(endpoint.params)) {
      url.searchParams.set(key, value);
    }
  }

  const startTime = Date.now();

  const response = await fetch(url.toString(), {
    method: endpoint.method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });

  const duration = Date.now() - startTime;
  const body = await response.text();

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // Not JSON
  }

  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    recordedAt: new Date().toISOString(),
    duration,
    request: {
      method: endpoint.method,
      url: url.toString(),
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      json,
    },
  };
};

/**
 * Record full trace
 */
const recordTrace = async (traceConfig: TraceConfig): Promise<Cassette> => {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error('Missing ACUITY_USER_ID or ACUITY_API_KEY in .env.test.local');
  }

  const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');
  const baseUrl = 'https://acuityscheduling.com/api/v1';

  const cassette: Cassette = {
    version: '1.0',
    name: traceConfig.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    config: {
      services: [traceConfig.service],
      maskedFields: [],
      mode: 'record',
    },
    entries: [],
  };

  for (const endpoint of traceConfig.endpoints) {
    console.log(`  Recording ${endpoint.name}...`);
    try {
      const entry = await recordEndpoint(baseUrl, auth, endpoint);
      cassette.entries.push(entry);

      if (entry.response.status === 403) {
        console.log(`    ⚠️  403 Forbidden - Powerhouse plan required`);
      } else if (entry.response.status >= 400) {
        console.log(`    ⚠️  ${entry.response.status} ${entry.response.statusText}`);
      } else {
        console.log(`    ✓ ${entry.response.status} (${entry.duration}ms)`);
      }
    } catch (error) {
      console.log(`    ✗ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return cassette;
};

/**
 * Compare two cassettes and report differences
 */
const compareCassettes = (
  oldCassette: Cassette,
  newCassette: Cassette
): { changed: boolean; report: string[] } => {
  const report: string[] = [];
  let changed = false;

  // Compare entry counts
  if (oldCassette.entries.length !== newCassette.entries.length) {
    report.push(`Entry count: ${oldCassette.entries.length} → ${newCassette.entries.length}`);
    changed = true;
  }

  // Compare each entry
  for (let i = 0; i < Math.min(oldCassette.entries.length, newCassette.entries.length); i++) {
    const oldEntry = oldCassette.entries[i];
    const newEntry = newCassette.entries[i];

    // Status code change
    if (oldEntry.response.status !== newEntry.response.status) {
      report.push(
        `${oldEntry.request.url}: status ${oldEntry.response.status} → ${newEntry.response.status}`
      );
      changed = true;
    }

    // Response shape change (for JSON responses)
    if (oldEntry.response.json && newEntry.response.json) {
      const oldKeys = Object.keys(
        Array.isArray(oldEntry.response.json) ? oldEntry.response.json[0] || {} : oldEntry.response.json
      );
      const newKeys = Object.keys(
        Array.isArray(newEntry.response.json) ? newEntry.response.json[0] || {} : newEntry.response.json
      );

      const addedKeys = newKeys.filter((k) => !oldKeys.includes(k));
      const removedKeys = oldKeys.filter((k) => !newKeys.includes(k));

      if (addedKeys.length > 0) {
        report.push(`${oldEntry.request.url}: added fields [${addedKeys.join(', ')}]`);
        changed = true;
      }
      if (removedKeys.length > 0) {
        report.push(`${oldEntry.request.url}: removed fields [${removedKeys.join(', ')}]`);
        changed = true;
      }
    }
  }

  return { changed, report };
};

// =============================================================================
// SCRIPT EXECUTION
// =============================================================================

const isDryRun = process.argv.includes('--dry-run');
const isCompare = process.argv.includes('--compare');
const serviceFilter = process.argv.includes('--service')
  ? process.argv[process.argv.indexOf('--service') + 1]
  : null;

const log = (msg: string) => console.log(msg);

const run = async () => {
  log('🎬 Refreshing API trace cassettes...\n');

  // Ensure cassettes directory exists
  if (!existsSync(CASSETTES_DIR)) {
    mkdirSync(CASSETTES_DIR, { recursive: true });
  }
  if (!existsSync(resolve(CASSETTES_DIR, 'acuity'))) {
    mkdirSync(resolve(CASSETTES_DIR, 'acuity'), { recursive: true });
  }

  const traces = [ACUITY_TRACES].filter(
    (t) => !serviceFilter || t.service === serviceFilter
  );

  if (traces.length === 0) {
    log(`No traces found for service: ${serviceFilter}`);
    process.exit(1);
  }

  for (const trace of traces) {
    log(`📼 Recording ${trace.name}...`);

    if (isDryRun) {
      log(`  Would record ${trace.endpoints.length} endpoints`);
      for (const endpoint of trace.endpoints) {
        log(`    - ${endpoint.method} ${endpoint.path}`);
      }
      continue;
    }

    try {
      const cassette = await recordTrace(trace);
      const maskedCassette = maskSensitiveData(cassette);

      const outPath = resolve(CASSETTES_DIR, trace.service, `${trace.name}.json`);

      // Compare mode
      if (isCompare && existsSync(outPath)) {
        const existing = JSON.parse(readFileSync(outPath, 'utf-8')) as Cassette;
        const { changed, report } = compareCassettes(existing, maskedCassette);

        if (changed) {
          log(`\n  ⚠️  API changes detected:`);
          for (const line of report) {
            log(`    - ${line}`);
          }
        } else {
          log(`  ✓ No API changes detected`);
        }
      }

      // Write cassette
      writeFileSync(outPath, JSON.stringify(maskedCassette, null, 2) + '\n');
      log(`  ✅ Saved to ${outPath.replace(resolve(__dirname, '..'), '')}`);
    } catch (error) {
      log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  log('\n✨ Done');
};

run().catch(console.error);
