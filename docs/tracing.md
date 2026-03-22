# API Tracing Guide

This document describes the API recording and replay system for `@tummycrypt/scheduling-kit`.

## Overview

The tracing system captures HTTP interactions with external APIs (Acuity, PayPal) for:

- **Deterministic testing**: Replay recorded responses without network access
- **API change detection**: Compare new recordings to detect breaking changes
- **Documentation**: Recorded cassettes serve as API response documentation
- **Debugging**: Inspect exact request/response data

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Test Code                                │
│                                                                  │
│   adapter.getServices()  ──►  fetch()  ──►  APIRecorder          │
│                                               │                  │
│                              ┌────────────────┼──────────────┐   │
│                              │   record mode  │  replay mode │   │
│                              ▼                ▼              │   │
│                         Real API          Cassette           │   │
│                              │                │              │   │
│                              ▼                ▼              │   │
│                         Save to           Return             │   │
│                         cassette          cached             │   │
│                                          response            │   │
└─────────────────────────────────────────────────────────────────┘
```

## Cassette Format

Cassettes are JSON files following an extended HAR (HTTP Archive) format:

```json
{
  "version": "1.0",
  "name": "acuity-services",
  "createdAt": "2026-02-03T10:00:00Z",
  "updatedAt": "2026-02-03T10:00:00Z",
  "environment": {
    "nodeVersion": "v20.10.0",
    "platform": "linux",
    "timezone": "America/New_York"
  },
  "config": {
    "services": ["acuity"],
    "maskedFields": ["authorization", "email"],
    "mode": "record"
  },
  "entries": [
    {
      "id": "entry-1234567890-abc123",
      "recordedAt": "2026-02-03T10:00:01Z",
      "duration": 245,
      "request": {
        "method": "GET",
        "url": "https://acuityscheduling.com/api/v1/appointment-types",
        "headers": {
          "authorization": "Basic [MASKED]"
        }
      },
      "response": {
        "status": 200,
        "statusText": "OK",
        "headers": { "content-type": "application/json" },
        "body": "[{\"id\":12345,...}]",
        "json": [{ "id": 12345, "name": "TMD Consultation" }]
      }
    }
  ]
}
```

## Recording Modes

| Mode | Behavior |
|------|----------|
| `record` | Make real API calls and save responses to cassette |
| `replay` | Return cached responses from cassette (no network) |
| `passthrough` | Make real API calls without recording |

## Usage

### Recording API Interactions

```typescript
import { APIRecorder, createAcuityRecorder } from '@tummycrypt/scheduling-kit/testing';

// Create recorder
const recorder = createAcuityRecorder('my-test-session', 'record');

// Start recording (intercepts global fetch)
recorder.start();

// Make API calls - they will be recorded
const services = await adapter.getServices()();
const providers = await adapter.getProviders()();

// Stop recording and get cassette
const cassette = await recorder.stop();

// Save cassette to file
import { serializeCassette } from '@tummycrypt/scheduling-kit/testing';
writeFileSync('cassettes/my-test.json', serializeCassette(cassette));
```

### Replaying from Cassette

```typescript
import { APIRecorder, parseCassette } from '@tummycrypt/scheduling-kit/testing';

// Load existing cassette
const cassetteJson = readFileSync('cassettes/my-test.json', 'utf-8');
const cassette = parseCassette(cassetteJson);

// Create recorder in replay mode
const recorder = new APIRecorder({
  mode: 'replay',
  cassetteName: cassette.name,
  services: cassette.config.services,
});

recorder.loadCassette(cassette);
recorder.start();

// API calls now return cached responses
const services = await adapter.getServices()(); // Returns recorded response

await recorder.stop();
```

### Using Helper Functions

```typescript
import { withRecording, withReplay } from '@tummycrypt/scheduling-kit/testing';

// Record a session
const { result, cassette } = await withRecording(
  'booking-flow',
  ['acuity', 'paypal'],
  async () => {
    const services = await adapter.getServices()();
    const booking = await adapter.createBooking(...)();
    return { services, booking };
  }
);

// Replay a session
const replayResult = await withReplay(cassette, async () => {
  // Same calls return same recorded responses
  return await adapter.getServices()();
});
```

## Data Masking

Sensitive data is automatically masked when recording:

### Default Masked Fields

- `authorization` header → `Basic [MASKED]`
- Email addresses → `masked@example.com`
- Phone numbers → `555-555-5555`
- API keys in URLs → `[MASKED]`

### Custom Masking

```typescript
import { APIRecorder, type MaskingConfig } from '@tummycrypt/scheduling-kit/testing';

const customMasking: MaskingConfig = {
  headers: ['authorization', 'x-api-key'],
  bodyFields: ['email', 'phone', 'ssn', 'creditCard'],
  urlParams: ['token', 'secret'],
  patterns: [
    { pattern: /\d{4}-\d{4}-\d{4}-\d{4}/, replacement: '[CREDIT_CARD]' },
    { pattern: /\d{3}-\d{2}-\d{4}/, replacement: '[SSN]' },
  ],
};

const recorder = new APIRecorder({
  mode: 'record',
  cassetteName: 'sensitive-data',
  services: ['payment'],
  masking: customMasking,
});
```

## API Change Detection

Compare cassettes to detect API changes:

```typescript
import { diffCassettes, hasBreakingChanges } from '@tummycrypt/scheduling-kit/testing';

const oldCassette = parseCassette(readFileSync('cassettes/old.json', 'utf-8'));
const newCassette = parseCassette(readFileSync('cassettes/new.json', 'utf-8'));

const diff = diffCassettes(oldCassette, newCassette);

if (hasBreakingChanges(diff)) {
  console.error('Breaking API changes detected!');
  console.log('Removed endpoints:', diff.removed);
  console.log('Changed responses:', diff.changed);
}
```

### Breaking Changes

The following are considered breaking:

- Removed endpoints (entries in old cassette not in new)
- Status code changes (e.g., 200 → 404)
- Removed response fields
- Changed response types

### Non-Breaking Changes

The following are considered non-breaking:

- Added endpoints
- Added response fields
- Changed field values (same type)

## Cassette Management

### Directory Structure

```
cassettes/
├── acuity/
│   ├── services-list.json
│   ├── availability-query.json
│   └── booking-flow.json
├── paypal/
│   └── venmo-capture.json
└── integration/
    └── full-checkout.json
```

### Maintenance Scripts

**Update fixtures** (regenerate from type definitions):

```bash
pnpm fixtures:update
```

**Refresh traces** (re-record from live API):

```bash
pnpm traces:refresh                  # All services
pnpm traces:refresh --service acuity # Only Acuity
pnpm traces:refresh --compare        # Compare to existing
pnpm traces:refresh --dry-run        # Preview only
```

## Best Practices

### 1. Keep Cassettes Small

Record only the interactions needed for a specific test scenario. Don't create one giant cassette for all tests.

### 2. Name Cassettes Descriptively

```
✓ acuity-availability-february-2026.json
✓ booking-with-venmo-payment.json
✗ test1.json
✗ recording.json
```

### 3. Version Cassettes

Include environment info in cassettes to track compatibility:

```json
{
  "environment": {
    "nodeVersion": "v20.10.0",
    "apiVersion": "v1"
  }
}
```

### 4. Review Masked Data

After recording, verify sensitive data was properly masked:

```bash
grep -r "apiKey\|password\|secret" cassettes/
```

### 5. Update Cassettes Regularly

Schedule periodic cassette refreshes to catch API changes early:

```bash
# CI job: weekly cassette refresh
pnpm traces:refresh --compare
```

### 6. Handle Unmatched Requests

Configure behavior for requests not in cassette:

```typescript
const recorder = new APIRecorder({
  // ...
  onUnmatchedRequest: (request) => {
    // Option 1: Return fallback response
    return { status: 404, statusText: 'Not Found', headers: {}, body: '' };

    // Option 2: Let it fail (default)
    return undefined;
  },
});
```

## Troubleshooting

### Request Not Matched in Replay

**Symptom**: "No matching cassette entry for GET /api/resource"

**Causes**:
1. URL path differs (check query params, trailing slash)
2. HTTP method differs
3. Entry not recorded

**Solution**:
- Check cassette entries: `cat cassette.json | jq '.entries[].request.url'`
- Re-record with the failing request

### Masked Data Too Aggressive

**Symptom**: Tests fail because needed data was masked

**Solution**:
- Customize masking config to exclude specific fields
- Use `enableMasking: false` for non-sensitive test data

### Stale Cassette

**Symptom**: Tests pass locally but API changed in production

**Solution**:
- Run `pnpm traces:refresh --compare` to detect changes
- Update cassettes and fix tests accordingly

### Large Cassette Files

**Symptom**: Cassettes are many MB in size

**Solution**:
- Record smaller, focused test scenarios
- Exclude response bodies for large payloads: `excludeBody: ['GET /large-report']`
- Compress cassettes: `gzip cassettes/*.json`

## Integration with CI

### GitLab CI Example

```yaml
test:unit:
  script:
    - pnpm test:unit
  rules:
    - if: '$CI_COMMIT_BRANCH'

test:cassette-check:
  script:
    - pnpm traces:refresh --compare --dry-run
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
  allow_failure: true
```

### GitHub Actions Example

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:unit

  cassette-check:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm traces:refresh --compare
        continue-on-error: true
```
