# Testing Guide

This document describes the testing strategy and practices for `@tummycrypt/scheduling-kit`.

## Test Types

| Type | Directory | Command | Purpose |
|------|-----------|---------|---------|
| Unit | `src/tests/` | `pnpm test:unit` | Test individual functions and modules |
| Integration | `tests/integration/` | `pnpm test:integration` | Test adapter interactions with mocked APIs |
| Component | N/A | `pnpm test:component` | Test Svelte components |
| Live | `tests/live/` | `pnpm test:live` | Test against real Acuity API |
| E2E | `tests/e2e/` | `pnpm test:e2e` | Full browser tests with Playwright |

## Quick Start

```bash
# Run all unit tests
pnpm test:unit

# Run tests in watch mode
pnpm test

# Run with coverage
pnpm test:coverage

# Run integration tests (uses MSW mocks)
pnpm test:integration

# Run live API tests (requires credentials)
RUN_LIVE_TESTS=true pnpm test:live
```

## Directory Structure

```
src/tests/
├── setup.ts                 # Global test setup
├── helpers/
│   ├── fp-ts.ts             # fp-ts assertion helpers
│   ├── factories.ts         # Test data factories (fast-check)
│   └── index.ts
├── fixtures/
│   ├── services.ts          # Service fixtures
│   ├── bookings.ts          # Booking fixtures
│   ├── providers.ts         # Provider fixtures
│   ├── index.ts
│   └── acuity/              # Raw Acuity API fixtures
│       ├── appointment-types.json
│       ├── calendars.json
│       └── ...
├── mocks/
│   ├── server.ts            # MSW server setup
│   └── handlers/
│       ├── acuity.ts        # Acuity API handlers
│       ├── paypal.ts        # PayPal API handlers
│       └── index.ts
├── unit/
│   ├── core/
│   │   └── pipelines.test.ts
│   ├── adapters/
│   │   └── acuity-transformers.test.ts
│   └── payments/
│       └── venmo.test.ts
├── types.test.ts            # Core type tests
├── utils.test.ts            # Utility function tests
└── ...

tests/
├── integration/
│   ├── acuity.test.ts       # Acuity adapter integration
│   └── booking-flow.test.ts # Full booking flow
├── live/
│   └── acuity.live.test.ts  # Live API tests
└── e2e/
    └── booking.spec.ts      # Playwright tests
```

## Writing Tests

### Unit Tests

Unit tests should be fast, isolated, and focused on a single unit of functionality.

```typescript
import { describe, it, expect } from 'vitest';
import * as E from 'fp-ts/Either';
import { expectRight, expectLeftTag } from '../helpers/fp-ts.js';

describe('myFunction', () => {
  it('returns Right on success', () => {
    const result = myFunction('valid input');
    expectRight(result, (value) => {
      expect(value).toBe('expected');
    });
  });

  it('returns Left with ValidationError on invalid input', () => {
    const result = myFunction('invalid');
    expectLeftTag(result, 'ValidationError');
  });
});
```

### fp-ts Test Helpers

The `src/tests/helpers/fp-ts.ts` module provides assertion helpers for `Either` and `TaskEither`:

```typescript
import { expectRight, expectLeft, expectLeftTag, runTask } from '../helpers/fp-ts.js';

// Assert Right and inspect value
expectRight(result, (value) => {
  expect(value.name).toBe('Test Service');
});

// Assert Left
expectLeft(result, (error) => {
  expect(error.message).toContain('failed');
});

// Assert Left with specific tag
expectLeftTag(result, 'AcuityError');

// Run TaskEither to Either
const result = await runTask(someTaskEither);
```

### Test Fixtures

Use the fixture modules for consistent test data:

```typescript
import { mockServices, mockProviders, mockBooking } from '../fixtures/index.js';

it('transforms services correctly', () => {
  const services = mockServices;
  // ... test with fixtures
});
```

### Factory Functions (fast-check)

For property-based testing, use the factory arbitraries:

```typescript
import fc from 'fast-check';
import { serviceArbitrary, clientArbitrary } from '../helpers/factories.js';

it('booking price always matches service price', () => {
  fc.assert(
    fc.property(serviceArbitrary, clientArbitrary, (service, client) => {
      const booking = createBooking(service, client);
      return booking.price === service.price;
    })
  );
});
```

### Integration Tests

Integration tests use MSW to mock external APIs:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { server } from '../../src/tests/mocks/server.js';
import { createAcuityAdapter } from '../../src/adapters/acuity.js';

describe('Acuity Adapter Integration', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('fetches services from Acuity', async () => {
    const adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test',
      apiKey: 'test',
    });

    const result = await adapter.getServices()();
    expectRight(result, (services) => {
      expect(services.length).toBeGreaterThan(0);
    });
  });
});
```

### Live Tests

Live tests run against the real Acuity API. They are gated by environment variables:

```typescript
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS === 'true';

describe.skipIf(!RUN_LIVE_TESTS)('Acuity Live API', () => {
  // Tests only run when RUN_LIVE_TESTS=true
});
```

**Setup for live tests:**

1. Copy `.env.test.local.example` to `.env.test.local`
2. Add your Acuity credentials
3. Run `RUN_LIVE_TESTS=true pnpm test:live`

**Important**: Live tests are read-only and should never create bookings or modify data.

## MSW Mock Handlers

### Adding New Handlers

Create handlers in `src/tests/mocks/handlers/`:

```typescript
// src/tests/mocks/handlers/newservice.ts
import { http, HttpResponse } from 'msw';

export const newServiceHandlers = [
  http.get('https://api.example.com/resource', () => {
    return HttpResponse.json({ data: 'mocked' });
  }),
];
```

Register in `src/tests/mocks/handlers/index.ts`:

```typescript
import { acuityHandlers } from './acuity.js';
import { paypalHandlers } from './paypal.js';
import { newServiceHandlers } from './newservice.js';

export const handlers = [
  ...acuityHandlers,
  ...paypalHandlers,
  ...newServiceHandlers,
];
```

### Handler Patterns

```typescript
// Success response
http.get('/api/resource', () => {
  return HttpResponse.json(mockData);
});

// Error response
http.get('/api/resource/:id', ({ params }) => {
  if (params.id === 'not-found') {
    return HttpResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return HttpResponse.json(mockData);
});

// Conditional based on query params
http.get('/api/search', ({ request }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  return HttpResponse.json({ results: filterByQuery(query) });
});
```

## Coverage

Coverage thresholds are configured in `vitest.config.ts`:

```typescript
coverage: {
  thresholds: {
    statements: 70,
    branches: 65,
    functions: 70,
    lines: 70,
  },
}
```

Run coverage report:

```bash
pnpm test:coverage
```

CI will fail if coverage drops below thresholds.

## Maintenance Scripts

### Update Fixtures

Regenerate static fixtures from type definitions:

```bash
pnpm fixtures:update
pnpm fixtures:update --dry-run  # Preview changes
```

### Refresh Traces

Re-record API cassettes from live endpoints:

```bash
pnpm traces:refresh                  # Record all
pnpm traces:refresh --service acuity # Only Acuity
pnpm traces:refresh --compare        # Compare to existing
```

## Best Practices

1. **Use descriptive test names**: Start with the function/component name, then describe the scenario.

2. **One assertion per test** (when practical): Makes failures easier to diagnose.

3. **Don't test implementation details**: Test behavior, not internal state.

4. **Use fixtures for consistent data**: Avoid magic values scattered in tests.

5. **Clean up after tests**: Use `afterEach` to reset state.

6. **Mock at the right level**: MSW mocks HTTP requests, not function calls.

7. **Keep tests fast**: Unit tests should complete in milliseconds.

8. **Write tests before fixing bugs**: Reproduces the issue and prevents regression.

## Troubleshooting

### Tests hang or timeout

- Check for unresolved promises
- Use `vi.useFakeTimers()` for timer-based code
- Increase timeout: `it('test', { timeout: 30000 }, async () => {...})`

### MSW requests not being intercepted

- Verify handler URL matches exactly
- Check server is started: `server.listen()`
- Enable debugging: `server.listen({ onUnhandledRequest: 'warn' })`

### Coverage not including files

- Check `coverage.include` patterns in vitest config
- Ensure files are imported in tests
- Svelte files need special handling (excluded by default)

### Live tests returning 403

- Acuity API requires Powerhouse plan ($50/mo) for any API access
- Tests are designed to handle 403 gracefully
- Use MSW mocks for comprehensive testing without API access
